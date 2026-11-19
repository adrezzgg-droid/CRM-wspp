import "server-only";
import { randomBytes } from "node:crypto";
import type { z } from "zod";
import type { Order, OrderStatus, Organization, OutboxItem } from "@/types/model";
import { COLLECTIONS, orgPath } from "@/types/model";
import { adminDb } from "@/server/firebase/admin";
import { serverEnv, usingEmulators } from "@/server/env";
import { ApiError } from "@/server/api/handler";
import { recordAuditIn } from "@/server/audit";
import { can, type Action } from "@/server/permissions/matrix";
import type { Session } from "@/server/auth/session";
import { changeOrderStatus } from "@/server/commercial/orders";
import { canTransition } from "@/lib/orders";
import { gestionStatusInput, type gestionConfigInput } from "@/lib/schemas";
import { open, seal } from "@/server/whatsapp/secret-box";
import { verifySignature } from "@/server/whatsapp/signature";
import { secretKeyOrNull } from "@/server/whatsapp/deps";
import {
  checkConnectorUrl,
  deliver,
  integrationSecretContext,
  processOutbox,
  type IntegrationSecrets,
  type IntegrationSettings,
  type OutboxEvent,
} from "./outbox-core";

const settingsRef = (orgId: string) => adminDb().collection(orgPath(orgId, "settings")).doc("integrations");
const secretsRef = (orgId: string) => adminDb().collection(orgPath(orgId, "secrets")).doc("integrations");

function requirePerm(session: Session, action: Action) {
  if (!can(session.role, "integraciones", action, session.overrides)) throw new ApiError(403, "Solo un administrador configura las integraciones");
}

export const outboxDeps = () => ({ db: adminDb(), secretKey: secretKeyOrNull() });

async function readGestionSecret(orgId: string, key: Buffer | null): Promise<string | undefined> {
  const sealed = ((await secretsRef(orgId).get()).data() as IntegrationSecrets | undefined)?.gestion;
  return sealed && key ? open(sealed, key, integrationSecretContext(orgId, "gestion")) : undefined;
}

// ───────────────────────────── Configuración ────────────────────────────────

export interface IntegrationsView {
  isDemo: boolean;
  canEdit: boolean;
  encryptionReady: boolean;
  gestion: {
    enabled: boolean;
    url: string;
    events: OutboxEvent[];
    /** Secreto compartido para firmar en las dos direcciones (solo administradores). */
    secret: string | null;
    /** Adónde el sistema de gestión informa el estado del reparto. */
    inboundUrl: string;
  };
  outbox: (Pick<OutboxItem, "id" | "connector" | "event" | "status" | "attempts" | "lastError" | "createdAt" | "deliveredAt" | "nextAttemptAt"> & { number: string | null })[];
}

export async function getIntegrationsView(session: Session): Promise<IntegrationsView> {
  requirePerm(session, "ver");
  const key = secretKeyOrNull();
  const [settings, secret, outbox] = await Promise.all([
    settingsRef(session.orgId).get(),
    readGestionSecret(session.orgId, key).catch(() => undefined),
    adminDb().collection(orgPath(session.orgId, "outbox")).orderBy("createdAt", "desc").limit(20).get(),
  ]);
  const g = (settings.data() as IntegrationSettings | undefined)?.connectors?.gestion;
  const base = (serverEnv().APP_URL ?? "").replace(/\/$/, "");
  return {
    isDemo: session.org.isDemo,
    canEdit: can(session.role, "integraciones", "editar", session.overrides),
    encryptionReady: !!key,
    gestion: {
      enabled: !!g?.enabled,
      url: g?.url ?? "",
      events: g?.events ?? ["order.confirmed", "order.cancelled"],
      secret: can(session.role, "integraciones", "editar", session.overrides) ? (secret ?? null) : null,
      inboundUrl: `${base}/api/integrations/gestion/${session.orgId}`,
    },
    outbox: outbox.docs.map((d) => {
      const o = d.data() as OutboxItem;
      return {
        id: d.id,
        connector: o.connector,
        event: o.event,
        status: o.status,
        attempts: o.attempts,
        lastError: o.lastError,
        createdAt: o.createdAt,
        deliveredAt: o.deliveredAt,
        nextAttemptAt: o.nextAttemptAt,
        number: typeof o.payload?.number === "string" ? o.payload.number : null,
      };
    }),
  };
}

export async function saveGestionConfig(session: Session, input: z.output<typeof gestionConfigInput>): Promise<IntegrationsView> {
  requirePerm(session, "editar");
  // El demo nunca manda pedidos de prueba a un sistema real.
  if (session.org.isDemo) throw new ApiError(409, "El demo no se conecta con otros sistemas.");
  const key = secretKeyOrNull();
  if (!key) throw new ApiError(503, "El servidor no tiene SECRETS_ENCRYPTION_KEY: sin esa clave no se puede guardar el secreto del conector.");
  const urlError = checkConnectorUrl(input.url, usingEmulators());
  if (urlError) throw new ApiError(422, urlError, [{ path: ["url"], message: urlError }]);
  const current = await readGestionSecret(session.orgId, key).catch(() => undefined);
  const secret = input.regenerateSecret || !current ? randomBytes(32).toString("base64url") : current;
  const now = Date.now();
  const before = (await settingsRef(session.orgId).get()).data() as IntegrationSettings | undefined;
  const batch = adminDb().batch();
  batch.set(settingsRef(session.orgId), { connectors: { gestion: { enabled: input.enabled, url: input.url, events: input.events, updatedAt: now, updatedBy: session.uid } } }, { merge: true });
  batch.set(secretsRef(session.orgId), { gestion: seal(secret, key, integrationSecretContext(session.orgId, "gestion")) }, { merge: true });
  recordAuditIn(batch, {
    orgId: session.orgId,
    isDemo: false,
    actorId: session.uid,
    action: "integration.updated",
    target: { collection: "settings", id: "integrations" },
    before: before?.connectors?.gestion ? { enabled: before.connectors.gestion.enabled, url: before.connectors.gestion.url, events: before.connectors.gestion.events } : undefined,
    after: { enabled: input.enabled, url: input.url, events: input.events, secretChanged: secret !== current },
  }, now);
  await batch.commit();
  return getIntegrationsView(session);
}

/** Envío de prueba (evento "ping") para comprobar dirección y firma. No queda en la cola. */
export async function testGestion(session: Session) {
  requirePerm(session, "editar");
  if (session.org.isDemo) throw new ApiError(409, "El demo no se conecta con otros sistemas.");
  const g = ((await settingsRef(session.orgId).get()).data() as IntegrationSettings | undefined)?.connectors?.gestion;
  const secret = await readGestionSecret(session.orgId, secretKeyOrNull());
  if (!g?.url || !secret) throw new ApiError(409, "Guardá primero la dirección del sistema de gestión");
  const r = await deliver(outboxDeps(), session.orgId, g.url, secret, { id: `ping-${Date.now()}`, event: "ping", payload: { message: "Prueba de conexión desde el CRM" }, createdAt: Date.now() });
  if (!r.ok) throw new ApiError(502, `El sistema de gestión no respondió bien: ${r.error}`);
  return { ok: true, status: r.status };
}

/** Volver a intentar un envío (después de corregir el problema del otro lado). */
export async function retryOutboxItem(session: Session, id: string) {
  requirePerm(session, "editar");
  const ref = adminDb().collection(orgPath(session.orgId, "outbox")).doc(id);
  const item = (await ref.get()).data() as OutboxItem | undefined;
  if (!item) throw new ApiError(404, "Envío no encontrado");
  if (item.status === "enviado") throw new ApiError(409, "Ya se entregó");
  await ref.update({ status: "pendiente", attempts: 0, nextAttemptAt: Date.now(), lastError: null });
  return processOutbox(outboxDeps(), session.orgId);
}

// ─────────────────────── Estado del reparto (entrante) ──────────────────────

/** Recorrido hacia adelante para llegar al estado informado (gestión puede saltear pasos). */
const FORWARD: OrderStatus[] = ["confirmado", "en_preparacion", "en_reparto", "entregado"];

/**
 * El sistema de gestión informa cómo va el pedido. Llega firmado con el
 * secreto compartido (X-CRM-Signature) y se aplica como un cambio de la
 * administración, con historial ("Sistema de gestión") y sin devolverle el aviso.
 */
export async function receiveGestionStatus(orgId: string, rawBody: string, signature: string | null): Promise<{ order: string; status: OrderStatus }> {
  const db = adminDb();
  const orgSnap = await db.collection(COLLECTIONS.organizations).doc(orgId).get();
  const org = orgSnap.data() as Organization | undefined;
  // Mismo error para "no existe" y "firma inválida": no se revela qué empresas hay.
  const secret = org && !org.isDemo ? await readGestionSecret(orgId, secretKeyOrNull()).catch(() => undefined) : undefined;
  if (!secret || !verifySignature(rawBody, signature, secret)) throw new ApiError(401, "Firma inválida");

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    throw new ApiError(400, "El cuerpo no es JSON");
  }
  const parsed = gestionStatusInput.safeParse((json as { data?: unknown })?.data ?? json);
  if (!parsed.success) throw new ApiError(422, "Datos inválidos", parsed.error.issues);
  const input = parsed.data;

  const orders = db.collection(orgPath(orgId, "orders"));
  const snap = input.orderId ? await orders.doc(input.orderId).get() : (await orders.where("number", "==", input.number).limit(1).get()).docs[0];
  if (!snap?.exists) throw new ApiError(404, "Pedido no encontrado");
  let order = { ...(snap.data() as Order), id: snap.id };

  const session: Session = {
    uid: "system",
    email: "",
    orgId,
    role: "admin",
    member: { displayName: "Sistema de gestión", teamIds: [], zoneIds: [], available: false },
    org: { id: orgId, name: org!.name, isDemo: false, timezone: org!.timezone, currency: org!.currency },
    overrides: {},
  };
  const deliveryRef = { system: "gestion", externalId: input.externalId ?? order.deliveryRef?.externalId ?? order.id, status: input.status };
  if (order.status === input.status) return { order: order.number, status: order.status };

  const steps: OrderStatus[] =
    input.status === "cancelado" || canTransition("admin", order.status, input.status)
      ? [input.status]
      : FORWARD.slice(FORWARD.indexOf(order.status) + 1, FORWARD.indexOf(input.status) + 1);
  if (!steps.length || FORWARD.indexOf(order.status) < 0) {
    throw new ApiError(409, `El pedido está "${order.status}" y no puede pasar a "${input.status}"`);
  }
  for (const status of steps) {
    order = await changeOrderStatus(session, order.id, { status, reason: status === "cancelado" ? (input.reason ?? "Cancelado en el sistema de gestión") : undefined }, { source: "gestion", deliveryRef });
  }
  return { order: order.number, status: order.status };
}
