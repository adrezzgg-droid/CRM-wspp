/**
 * Cliente mínimo de la Graph API de Meta para WhatsApp Cloud API.
 *
 * Código puro: recibe el token, la versión y (en las pruebas) un `fetch`
 * falso. No sabe de empresas ni de Firestore; eso lo resuelve quien lo usa.
 *
 * Referencias:
 *   Mensajes   POST /{phone-number-id}/messages
 *   Medios     POST /{phone-number-id}/media · GET /{media-id} · GET <url firmada>
 *   Plantillas GET|POST|DELETE /{waba-id}/message_templates · POST /{template-id}
 *   Webhooks   POST /{waba-id}/subscribed_apps
 */

export interface GraphConfig {
  token: string;
  version: string;
  /** https://graph.facebook.com (se cambia solo en pruebas). */
  baseUrl?: string;
  fetch?: typeof fetch;
}

export class GraphError extends Error {
  readonly httpStatus: number;
  readonly code?: number;
  readonly subcode?: number;
  readonly details?: string;
  readonly userMessage?: string;
  constructor(httpStatus: number, body: MetaErrorBody["error"] | undefined, fallback: string) {
    super(body?.message ?? fallback);
    this.httpStatus = httpStatus;
    this.code = body?.code;
    this.subcode = body?.error_subcode;
    this.details = body?.error_data?.details;
    this.userMessage = body?.error_user_msg;
  }
}

interface MetaErrorBody {
  error?: { message?: string; code?: number; error_subcode?: number; error_user_msg?: string; error_data?: { details?: string } };
}

const DEFAULT_BASE = "https://graph.facebook.com";

async function request<T>(cfg: GraphConfig, method: "GET" | "POST" | "DELETE", path: string, opts: { json?: unknown; form?: FormData; query?: Record<string, string> } = {}): Promise<T> {
  const url = new URL(`${cfg.baseUrl ?? DEFAULT_BASE}/${cfg.version}/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
  const headers: Record<string, string> = { Authorization: `Bearer ${cfg.token}` };
  let body: BodyInit | undefined;
  if (opts.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.json);
  } else if (opts.form) {
    body = opts.form;
  }
  const res = await (cfg.fetch ?? fetch)(url, { method, headers, body, signal: AbortSignal.timeout(20_000) });
  const data = (await res.json().catch(() => ({}))) as T & MetaErrorBody;
  if (!res.ok || data.error) throw new GraphError(res.status, data.error, `Meta respondió ${res.status}`);
  return data;
}

// ───────────────────────────── Mensajes ─────────────────────────────────────

export type MediaKind = "image" | "document" | "audio" | "video";

export const textPayload = (to: string, text: string) => ({
  messaging_product: "whatsapp",
  recipient_type: "individual",
  to,
  type: "text",
  text: { body: text, preview_url: /https?:\/\//.test(text) },
});

export function templatePayload(to: string, t: { name: string; language: string; params: string[] }) {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "template",
    template: {
      name: t.name,
      language: { code: t.language },
      ...(t.params.length ? { components: [{ type: "body", parameters: t.params.map((text) => ({ type: "text", text })) }] } : {}),
    },
  };
}

export function mediaPayload(to: string, kind: MediaKind, mediaId: string, extra: { caption?: string; fileName?: string } = {}) {
  // El audio no admite texto; el nombre de archivo solo aplica a documentos.
  const media: Record<string, string> = { id: mediaId };
  if (extra.caption && kind !== "audio") media.caption = extra.caption;
  if (extra.fileName && kind === "document") media.filename = extra.fileName;
  return { messaging_product: "whatsapp", recipient_type: "individual", to, type: kind, [kind]: media };
}

export async function sendMessage(cfg: GraphConfig, phoneNumberId: string, payload: object): Promise<{ wamid: string }> {
  const data = await request<{ messages?: { id: string }[] }>(cfg, "POST", `${phoneNumberId}/messages`, { json: payload });
  const wamid = data.messages?.[0]?.id;
  if (!wamid) throw new GraphError(502, undefined, "Meta no devolvió el id del mensaje");
  return { wamid };
}

/** Confirmación de lectura (los dos tildes azules del lado del cliente). */
export async function markAsRead(cfg: GraphConfig, phoneNumberId: string, wamid: string): Promise<void> {
  await request(cfg, "POST", `${phoneNumberId}/messages`, { json: { messaging_product: "whatsapp", status: "read", message_id: wamid } });
}

// ────────────────────────────── Medios ──────────────────────────────────────

export async function uploadMedia(cfg: GraphConfig, phoneNumberId: string, file: { bytes: Uint8Array; mimeType: string; fileName: string }): Promise<string> {
  const form = new FormData();
  form.set("messaging_product", "whatsapp");
  form.set("type", file.mimeType);
  form.set("file", new Blob([new Uint8Array(file.bytes)], { type: file.mimeType }), file.fileName);
  const data = await request<{ id?: string }>(cfg, "POST", `${phoneNumberId}/media`, { form });
  if (!data.id) throw new GraphError(502, undefined, "Meta no devolvió el id del archivo");
  return data.id;
}

/** Un archivo que mandó el cliente: primero la URL firmada, después los bytes (con el mismo token). */
export async function downloadMedia(cfg: GraphConfig, mediaId: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const info = await request<{ url?: string; mime_type?: string }>(cfg, "GET", mediaId);
  if (!info.url) throw new GraphError(404, undefined, "El archivo ya no está disponible en WhatsApp");
  const res = await (cfg.fetch ?? fetch)(info.url, { headers: { Authorization: `Bearer ${cfg.token}` }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new GraphError(res.status, undefined, `No se pudo descargar el archivo (${res.status})`);
  return { bytes: new Uint8Array(await res.arrayBuffer()), mimeType: info.mime_type ?? res.headers.get("content-type") ?? "application/octet-stream" };
}

// ───────────────────────────── Cuenta ───────────────────────────────────────

export interface PhoneInfo {
  display_phone_number?: string;
  verified_name?: string;
  quality_rating?: string;
}

export const phoneInfo = (cfg: GraphConfig, phoneNumberId: string) =>
  request<PhoneInfo>(cfg, "GET", phoneNumberId, { query: { fields: "display_phone_number,verified_name,quality_rating" } });

/** Sin esto Meta no manda los webhooks de esa cuenta a la app. */
export const subscribeApp = (cfg: GraphConfig, wabaId: string) => request<{ success?: boolean }>(cfg, "POST", `${wabaId}/subscribed_apps`);

// ──────────────────────────── Plantillas ────────────────────────────────────

export interface MetaTemplate {
  id: string;
  name: string;
  language: string;
  status: string;
  category?: string;
  rejected_reason?: string;
}

export function templateComponents(metaText: string, examples: string[]) {
  return [{ type: "BODY", text: metaText, ...(examples.length ? { example: { body_text: [examples] } } : {}) }];
}

export const createTemplate = (cfg: GraphConfig, wabaId: string, t: { name: string; language: string; category: string; metaText: string; examples: string[] }) =>
  request<{ id: string; status?: string }>(cfg, "POST", `${wabaId}/message_templates`, {
    json: { name: t.name, language: t.language, category: t.category.toUpperCase(), components: templateComponents(t.metaText, t.examples) },
  });

/** Editar una plantilla ya creada: vuelve a revisión de Meta. */
export const editTemplate = (cfg: GraphConfig, templateId: string, t: { category: string; metaText: string; examples: string[] }) =>
  request<{ success?: boolean }>(cfg, "POST", templateId, { json: { category: t.category.toUpperCase(), components: templateComponents(t.metaText, t.examples) } });

export async function listTemplates(cfg: GraphConfig, wabaId: string): Promise<MetaTemplate[]> {
  const out: MetaTemplate[] = [];
  let after: string | undefined;
  for (let page = 0; page < 20; page++) {
    const data = await request<{ data?: MetaTemplate[]; paging?: { cursors?: { after?: string }; next?: string } }>(cfg, "GET", `${wabaId}/message_templates`, {
      query: { fields: "id,name,language,status,category,rejected_reason", limit: "100", ...(after ? { after } : {}) },
    });
    out.push(...(data.data ?? []));
    after = data.paging?.next ? data.paging.cursors?.after : undefined;
    if (!after) break;
  }
  return out;
}

export const deleteTemplate = (cfg: GraphConfig, wabaId: string, t: { name: string; metaTemplateId?: string }) =>
  request<{ success?: boolean }>(cfg, "DELETE", `${wabaId}/message_templates`, { query: { name: t.name, ...(t.metaTemplateId ? { hsm_id: t.metaTemplateId } : {}) } });

/** Estado de Meta → estado del CRM. Pausada o desactivada no se puede enviar: queda como rechazada con el motivo. */
export function mapTemplateStatus(status: string): "pendiente" | "aprobada" | "rechazada" {
  switch (status.toUpperCase()) {
    case "APPROVED":
      return "aprobada";
    case "PENDING":
    case "IN_APPEAL":
    case "PENDING_DELETION":
      return "pendiente";
    default:
      return "rechazada";
  }
}

// ───────────────────────── Errores para la persona ──────────────────────────

/**
 * Traduce un error de Meta a algo que el equipo entienda, con el código HTTP
 * que corresponde devolver. `reconnect` = hay que cargar un token nuevo.
 */
export function explainGraphError(e: unknown): { status: number; message: string; reconnect?: boolean } {
  if (!(e instanceof GraphError)) {
    const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return { status: 504, message: timeout ? "WhatsApp tardó demasiado en responder. Probá de nuevo." : "No se pudo conectar con WhatsApp. Probá de nuevo en unos minutos." };
  }
  switch (e.code) {
    case 190:
      return { status: 503, reconnect: true, message: "La conexión con WhatsApp venció o el token no es válido. Un administrador tiene que cargar un token nuevo en Configuración → WhatsApp." };
    case 10:
    case 200:
    case 294:
      return { status: 503, reconnect: true, message: "El token no tiene permiso para esta cuenta de WhatsApp (whatsapp_business_messaging / management)." };
    case 131047:
      return { status: 409, message: "Pasaron más de 24 h desde el último mensaje del cliente: solo se le puede escribir con una plantilla aprobada." };
    case 131026:
      return { status: 422, message: "Ese número no puede recibir mensajes de WhatsApp." };
    case 131030:
      return { status: 422, message: "Con el número de prueba de Meta solo se puede escribir a los destinatarios de prueba agregados en la app." };
    case 132000:
      return { status: 422, message: "La cantidad de variables no coincide con la plantilla aprobada en Meta." };
    case 132001:
      return { status: 409, message: "La plantilla no existe en Meta con ese nombre e idioma. Sincronizá las plantillas." };
    case 132015:
    case 132016:
      return { status: 409, message: "Meta pausó o desactivó esta plantilla." };
    case 4:
    case 80007:
    case 130429:
    case 131048:
    case 131056:
      return { status: 429, message: "Meta está limitando los envíos. Probá de nuevo en unos minutos." };
    case 131031:
    case 368:
      return { status: 503, message: "Meta restringió la cuenta de WhatsApp. Revisá el administrador de WhatsApp de Meta." };
    default:
      return { status: 502, message: `WhatsApp rechazó la operación: ${e.userMessage ?? e.details ?? e.message}` };
  }
}
