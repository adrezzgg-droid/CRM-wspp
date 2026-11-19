/**
 * Cola de salida hacia otros sistemas (`organizations/{orgId}/outbox`). Sin
 * Next: la usan la tarea programada, el botón "Reintentar" y las pruebas.
 *
 * Cada envío es un POST JSON firmado con HMAC-SHA256 (mismo esquema que los
 * webhooks de Meta) con el secreto compartido del conector:
 *
 *   X-CRM-Event:     order.confirmed | order.cancelled | ping
 *   X-CRM-Delivery:  id del envío (el receptor lo usa para no procesar dos veces)
 *   X-CRM-Signature: sha256=<hex del HMAC del cuerpo>
 *
 * 2xx = entregado. Error de red, 408, 429 o 5xx = se reintenta con espera
 * creciente (1 min … 24 h). Otro 4xx = el receptor no lo acepta: queda en error
 * sin reintentar (se puede reintentar a mano después de corregirlo).
 */
import type { Firestore } from "firebase-admin/firestore";
import type { OutboxItem } from "../../types/model.ts";
import { open } from "../whatsapp/secret-box.ts";
import { signBody } from "../whatsapp/signature.ts";

export const CONNECTORS = ["gestion"] as const;
export type ConnectorName = (typeof CONNECTORS)[number];

export const OUTBOX_EVENTS = ["order.confirmed", "order.cancelled"] as const;
export type OutboxEvent = (typeof OUTBOX_EVENTS)[number];

/** `organizations/{orgId}/settings/integrations` */
export interface IntegrationSettings {
  connectors: Partial<Record<ConnectorName, { enabled: boolean; url?: string; events?: OutboxEvent[]; updatedAt?: number; updatedBy?: string }>>;
}

/** `organizations/{orgId}/secrets/integrations`: un secreto cifrado por conector. */
export type IntegrationSecrets = Partial<Record<ConnectorName, string>>;

export const integrationSecretContext = (orgId: string, connector: ConnectorName) => `${orgId}:integrations.${connector}`;

/** Esperas entre reintentos, en minutos. Después del último, queda en error. */
export const BACKOFF_MINUTES = [1, 5, 15, 60, 180, 360, 720, 1440];
export const MAX_ATTEMPTS = BACKOFF_MINUTES.length;

export interface OutboxDeps {
  db: Firestore;
  secretKey: Buffer | null;
  fetch?: typeof fetch;
  now?: () => number;
}

export interface DeliveryResult {
  ok: boolean;
  status?: number;
  /** No tiene sentido reintentar (el receptor rechazó el contenido). */
  permanent?: boolean;
  error?: string;
}

export function deliveryRequest(orgId: string, item: Pick<OutboxItem, "id" | "event" | "payload" | "createdAt">, secret: string) {
  const body = JSON.stringify({ id: item.id, event: item.event, orgId, createdAt: item.createdAt, data: item.payload });
  return {
    body,
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "CRM-WhatsApp-Conector/1",
      "X-CRM-Event": item.event,
      "X-CRM-Delivery": item.id,
      "X-CRM-Signature": signBody(body, secret),
    },
  };
}

export async function deliver(deps: OutboxDeps, orgId: string, url: string, secret: string, item: Pick<OutboxItem, "id" | "event" | "payload" | "createdAt">): Promise<DeliveryResult> {
  const { body, headers } = deliveryRequest(orgId, item, secret);
  try {
    const res = await (deps.fetch ?? fetch)(url, { method: "POST", headers, body, redirect: "manual", signal: AbortSignal.timeout(15_000) });
    if (res.ok) return { ok: true, status: res.status };
    const text = (await res.text().catch(() => "")).slice(0, 300);
    const retryable = res.status === 408 || res.status === 429 || res.status >= 500;
    return { ok: false, status: res.status, permanent: !retryable, error: `HTTP ${res.status}${text ? `: ${text}` : ""}` };
  } catch (error) {
    const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return { ok: false, error: timeout ? "Sin respuesta en 15 s" : `No se pudo conectar: ${error instanceof Error ? error.message : String(error)}` };
  }
}

async function connectorConfig(db: Firestore, orgId: string, key: Buffer | null, connector: ConnectorName) {
  const org = db.collection("organizations").doc(orgId);
  const [settings, secrets] = await Promise.all([org.collection("settings").doc("integrations").get(), org.collection("secrets").doc("integrations").get()]);
  const cfg = (settings.data() as IntegrationSettings | undefined)?.connectors?.[connector];
  const sealed = (secrets.data() as IntegrationSecrets | undefined)?.[connector];
  if (!cfg?.enabled || !cfg.url || !sealed || !key) return null;
  return { url: cfg.url, secret: open(sealed, key, integrationSecretContext(orgId, connector)) };
}

/** Procesa lo pendiente de una empresa cuyo momento de reintento ya llegó. */
export async function processOutbox(deps: OutboxDeps, orgId: string): Promise<{ sent: number; retrying: number; failed: number }> {
  const now = (deps.now ?? Date.now)();
  const snap = await deps.db.collection("organizations").doc(orgId).collection("outbox").where("status", "==", "pendiente").limit(100).get();
  const due = snap.docs.filter((d) => ((d.data() as OutboxItem).nextAttemptAt ?? 0) <= now);
  const out = { sent: 0, retrying: 0, failed: 0 };
  const configs = new Map<string, Awaited<ReturnType<typeof connectorConfig>>>();
  for (const d of due) {
    const item = { ...(d.data() as OutboxItem), id: d.id };
    const connector = item.connector as ConnectorName;
    if (!configs.has(connector)) configs.set(connector, await connectorConfig(deps.db, orgId, deps.secretKey, connector).catch(() => null));
    const cfg = configs.get(connector);
    // Conector apagado o sin configurar: el envío espera (no gasta intentos).
    if (!cfg) continue;
    const r = await deliver(deps, orgId, cfg.url, cfg.secret, item);
    const attempts = (item.attempts ?? 0) + 1;
    if (r.ok) {
      await d.ref.update({ status: "enviado", attempts, deliveredAt: now, lastError: null });
      out.sent += 1;
    } else if (r.permanent || attempts >= MAX_ATTEMPTS) {
      await d.ref.update({ status: "error", attempts, lastError: r.error ?? "Error", nextAttemptAt: null });
      out.failed += 1;
    } else {
      await d.ref.update({ attempts, lastError: r.error ?? "Error", nextAttemptAt: now + BACKOFF_MINUTES[attempts - 1] * 60_000 });
      out.retrying += 1;
    }
  }
  return out;
}

export async function processOutboxAll(deps: OutboxDeps) {
  const orgs = await deps.db.collection("organizations").where("status", "==", "active").get();
  const results: ({ orgId: string } & Awaited<ReturnType<typeof processOutbox>>)[] = [];
  for (const o of orgs.docs) {
    if (o.get("isDemo")) continue;
    results.push({ orgId: o.id, ...(await processOutbox(deps, o.id)) });
  }
  return results;
}

/**
 * URL a la que se le permite mandar datos. Es un dato que carga un
 * administrador y el servidor hace el POST: se exige https y se rechazan
 * direcciones internas (evita usar el CRM para llegar a la red privada del
 * servidor). En desarrollo con emuladores se permite http://localhost.
 */
export function checkConnectorUrl(raw: string, allowLocal: boolean): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "La dirección no es válida";
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const local = host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1" || host === "::1";
  if (allowLocal && local) return url.protocol === "http:" || url.protocol === "https:" ? null : "Solo http o https";
  if (url.protocol !== "https:") return "Tiene que empezar con https://";
  if (url.username || url.password) return "Sin usuario ni contraseña en la dirección (la firma ya autentica)";
  const privateV4 = /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;
  if (local || privateV4.test(host) || host === "metadata.google.internal" || /^(fc|fd|fe80)/.test(host) || host.endsWith(".internal") || host.endsWith(".local")) {
    return "No se permiten direcciones internas";
  }
  return null;
}
