/**
 * Webhook de WhatsApp Cloud API. Sin Next: lo usan la ruta /api/webhooks/whatsapp,
 * la tarea programada (reintentos) y las pruebas contra el emulador.
 *
 * Dos pasos, para responderle a Meta enseguida:
 *   1. `acceptWebhook`: reparte el payload entre empresas (por número / WABA),
 *      valida la firma con el App Secret de CADA empresa (o el global) y guarda
 *      el evento crudo en `webhookEvents`. Una empresa con app propia no puede
 *      inyectar eventos de otra: cada parte se valida con el secreto de su dueño.
 *   2. `processWebhookEvent`: descarga adjuntos, ingiere mensajes (idempotente
 *      por wamid), aplica estados de entrega y de plantillas. Si falla, queda
 *      en error y `retryWebhookEvents` lo reintenta.
 */
import type { Firestore } from "firebase-admin/firestore";
import type { AuditLog, Organization, WebhookEvent, WhatsappTemplate } from "../../types/model.ts";
import { parseWebhook, routeKeyOf, type MetaWebhookPayload, type TemplateStatusUpdate } from "../../lib/whatsapp/webhook.ts";
import { applyStatus, conversationIdFor, ingestInbound, type IngestResult } from "../inbox/ingest-core.ts";
import { readCredentials, readSecrets, resolveRoutes, VERIFY_TOKENS } from "./accounts-core.ts";
import { downloadMedia, mapTemplateStatus } from "./graph.ts";
import { sha256Hex, verifySignature } from "./signature.ts";

const EVENTS = "webhookEvents";
const KEEP_DAYS = 30;
export const MAX_ATTEMPTS = 5;

export interface WebhookDeps {
  db: Firestore;
  /** App Secret de la app de Meta de la plataforma (WHATSAPP_APP_SECRET). */
  globalAppSecret?: string;
  /** Verify Token global (WHATSAPP_VERIFY_TOKEN), además del de cada empresa. */
  globalVerifyToken?: string;
  /** Clave para descifrar los secretos de cada empresa (null = no configurada). */
  secretKey: Buffer | null;
  graph: { version: string; baseUrl?: string; fetch?: typeof fetch };
  storeMedia(orgId: string, conversationId: string, file: { bytes: Uint8Array; mimeType: string; fileName: string }): Promise<{ storagePath: string; size: number }>;
  /** Después de guardar una conversación nueva (automatizaciones de bienvenida). */
  onNewConversation?(orgId: string, result: IngestResult): Promise<void>;
  now?: () => number;
}

export class WebhookRejected extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Entry = NonNullable<MetaWebhookPayload["entry"]>[number];
type Change = NonNullable<Entry["changes"]>[number];

const clock = (deps: WebhookDeps) => (deps.now ?? Date.now)();

/** Paso 1: validar y guardar. Devuelve los ids de evento a procesar. */
export async function acceptWebhook(deps: WebhookDeps, rawBody: string, signature: string | null): Promise<string[]> {
  let payload: MetaWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as MetaWebhookPayload;
  } catch {
    throw new WebhookRejected(400, "El cuerpo no es JSON");
  }

  // Partes del payload por destino.
  const parts = new Map<string, { entryId: string; change: Change }[]>();
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const key = routeKeyOf(entry.id, change);
      if (!key) continue;
      parts.set(key, [...(parts.get(key) ?? []), { entryId: entry.id, change }]);
    }
  }
  const routes = await resolveRoutes(deps.db, [...parts.keys()]);

  // Agrupar por empresa (una empresa puede tener número y WABA en el mismo payload).
  const byOrg = new Map<string, { accountId: string; parts: { entryId: string; change: Change }[] }>();
  const orphan: { entryId: string; change: Change }[] = [];
  for (const [key, list] of parts) {
    const route = routes.get(key);
    if (!route) {
      orphan.push(...list);
      continue;
    }
    const g = byOrg.get(route.orgId) ?? { accountId: route.accountId, parts: [] };
    g.parts.push(...list);
    byOrg.set(route.orgId, g);
  }

  const now = clock(deps);
  const expireAt = new Date(now + KEEP_DAYS * 86_400_000);
  const ids: string[] = [];
  let rejected = 0;
  let signedByPlatform: boolean | null = null;
  const platformOk = () => (signedByPlatform ??= verifySignature(rawBody, signature, deps.globalAppSecret));

  for (const [orgId, g] of byOrg) {
    const { appSecret } = await readSecrets(deps.db, orgId, deps.secretKey).catch(() => ({ appSecret: undefined }));
    const ok = appSecret ? verifySignature(rawBody, signature, appSecret) : platformOk();
    if (!ok) {
      rejected += 1;
      console.warn(`[webhook] firma inválida para la empresa ${orgId}`);
      continue;
    }
    const ref = deps.db.collection(EVENTS).doc();
    const event: WebhookEvent = {
      id: ref.id,
      orgId,
      accountId: g.accountId,
      source: "whatsapp",
      receivedAt: now,
      status: "recibido",
      attempts: 0,
      payload: { object: payload.object, entry: regroup(g.parts) },
      expireAt,
    };
    await ref.set(event);
    ids.push(ref.id);
  }

  if (orphan.length && platformOk()) {
    // Firmado por Meta pero para un número que no está conectado: se guarda para diagnosticar.
    const ref = deps.db.collection(EVENTS).doc();
    await ref.set({ id: ref.id, source: "whatsapp", receivedAt: now, status: "sin_empresa", attempts: 0, payload: { object: payload.object, entry: regroup(orphan) }, expireAt } satisfies WebhookEvent);
  }

  // Sin ninguna parte con firma válida (o nada que firmar y firma inválida): se rechaza.
  if (!ids.length && (rejected > 0 || !platformOk())) throw new WebhookRejected(401, "Firma inválida");
  return ids;
}

function regroup(parts: { entryId: string; change: Change }[]): Entry[] {
  const byEntry = new Map<string, Change[]>();
  for (const p of parts) byEntry.set(p.entryId, [...(byEntry.get(p.entryId) ?? []), p.change]);
  return [...byEntry].map(([id, changes]) => ({ id, changes }));
}

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "video/mp4": "mp4",
  "application/pdf": "pdf",
};
const fileNameFor = (mime: string, wamid: string, given?: string) => given ?? `whatsapp-${wamid.slice(-8)}.${EXT[mime.split(";")[0]] ?? "bin"}`;

/** Paso 2: procesar un evento guardado. Idempotente: se puede repetir sin duplicar. */
export async function processWebhookEvent(deps: WebhookDeps, eventId: string): Promise<WebhookEvent["status"] | "inexistente"> {
  const ref = deps.db.collection(EVENTS).doc(eventId);
  const snap = await ref.get();
  const ev = snap.data() as WebhookEvent | undefined;
  if (!ev) return "inexistente";
  if (ev.status === "procesado" || ev.status === "sin_empresa" || !ev.orgId || !ev.accountId) return ev.status;
  const { orgId, accountId } = ev;
  const now = clock(deps);
  try {
    const org = (await deps.db.collection("organizations").doc(orgId).get()).data() as Organization | undefined;
    // El demo nunca recibe tráfico real (y una empresa inexistente, tampoco).
    if (!org || org.isDemo) throw new Error("La empresa no existe o es de demostración");
    const parsed = parseWebhook(ev.payload as MetaWebhookPayload);
    const creds = parsed.messages.some((m) => m.media) ? await readCredentials(deps.db, orgId, deps.secretKey) : null;

    for (const m of parsed.messages) {
      let storedMedia: { storagePath: string; size: number } | undefined;
      if (m.media && creds) {
        try {
          const file = await downloadMedia({ token: creds.accessToken, ...deps.graph }, m.media.mediaId);
          storedMedia = await deps.storeMedia(orgId, conversationIdFor(accountId, m.from), {
            bytes: file.bytes,
            mimeType: file.mimeType,
            fileName: fileNameFor(file.mimeType, m.wamid, m.media.fileName),
          });
        } catch (error) {
          // El mensaje entra igual; el archivo se baja al abrirlo (mientras Meta lo conserve).
          console.warn(`[webhook] no se pudo descargar el adjunto ${m.media.mediaId}`, error);
        }
      }
      const result = await ingestInbound(deps.db, { orgId, isDemo: false, accountId, storedMedia }, m, now);
      if (!result.duplicate && result.newConversation) await deps.onNewConversation?.(orgId, result);
    }
    for (const s of parsed.statuses) await applyStatus(deps.db, { orgId, accountId }, s);
    for (const t of parsed.templates) await applyTemplateStatus(deps.db, orgId, t, now);

    await ref.update({ status: "procesado", processedAt: now, attempts: (ev.attempts ?? 0) + 1, error: null });
    await deps.db.collection("organizations").doc(orgId).collection("whatsappAccounts").doc(accountId).update({ lastWebhookAt: now }).catch(() => undefined);
    return "procesado";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[webhook] evento ${eventId}`, error);
    await ref.update({ status: "error", attempts: (ev.attempts ?? 0) + 1, error: message.slice(0, 500) });
    return "error";
  }
}

/** Meta aprobó / rechazó / pausó una plantilla: se actualiza la del CRM (por id de Meta o por nombre e idioma). */
export async function applyTemplateStatus(db: Firestore, orgId: string, t: TemplateStatusUpdate, now: number): Promise<boolean> {
  const col = db.collection("organizations").doc(orgId).collection("whatsappTemplates");
  let docs = t.metaTemplateId ? (await col.where("metaTemplateId", "==", t.metaTemplateId).get()).docs : [];
  if (!docs.length) docs = (await col.where("name", "==", t.name).get()).docs.filter((d) => !t.language || (d.data() as WhatsappTemplate).language === t.language);
  if (!docs.length) return false;
  const metaStatus: WhatsappTemplate["metaStatus"] = mapTemplateStatus(t.event);
  const batch = db.batch();
  for (const d of docs) {
    const current = d.data() as WhatsappTemplate;
    const rejectedReason = metaStatus === "rechazada" ? (t.reason ?? t.event) : null;
    batch.update(d.ref, { metaStatus, metaTemplateId: t.metaTemplateId || current.metaTemplateId || null, rejectedReason, updatedAt: now, updatedBy: "system" });
    const audit = db.collection("organizations").doc(orgId).collection("auditLogs").doc();
    batch.create(audit, {
      id: audit.id,
      orgId,
      isDemo: false,
      at: now,
      actorId: "system",
      action: "template.status",
      target: { collection: "whatsappTemplates", id: d.id },
      before: { metaStatus: current.metaStatus },
      after: { metaStatus, event: t.event, reason: t.reason ?? null },
    } satisfies AuditLog);
  }
  await batch.commit();
  return true;
}

/** Reintentos (tarea programada): eventos que quedaron sin procesar o con error. */
export async function retryWebhookEvents(deps: WebhookDeps): Promise<{ retried: number; failed: number }> {
  const now = clock(deps);
  const snap = await deps.db.collection(EVENTS).where("status", "in", ["recibido", "error"]).limit(100).get();
  let retried = 0;
  let failed = 0;
  for (const d of snap.docs) {
    const ev = d.data() as WebhookEvent;
    // Lo recién llegado lo está procesando la propia petición.
    if (ev.receivedAt > now - 60_000 || (ev.attempts ?? 0) >= MAX_ATTEMPTS) continue;
    retried += 1;
    if ((await processWebhookEvent(deps, d.id)) === "error") failed += 1;
  }
  return { retried, failed };
}

/**
 * Verificación del webhook (GET de Meta con hub.verify_token). Vale el token
 * global o el de alguna empresa; en ese caso la cuenta queda "verificada".
 */
export async function verifyWebhookToken(deps: WebhookDeps, token: string | null): Promise<boolean> {
  if (!token) return false;
  if (deps.globalVerifyToken && sha256Hex(token) === sha256Hex(deps.globalVerifyToken)) return true;
  const snap = await deps.db.collection(VERIFY_TOKENS).doc(sha256Hex(token)).get();
  if (!snap.exists) return false;
  const { orgId, accountId } = snap.data() as { orgId: string; accountId: string };
  const now = clock(deps);
  await deps.db.collection("organizations").doc(orgId).collection("whatsappAccounts").doc(accountId).update({ webhookStatus: "verificado", webhookVerifiedAt: now }).catch(() => undefined);
  return true;
}
