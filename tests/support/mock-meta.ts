/**
 * Simulador local de la Graph API de Meta (WhatsApp Cloud API) y de un
 * sistema de gestión, para probar la integración de punta a punta sin
 * cuenta de Meta. Lo levantan las pruebas; el CRM le habla porque en
 * desarrollo WHATSAPP_GRAPH_BASE_URL apunta acá.
 *
 * Responde como Meta en lo que usa el CRM y registra cada llamada para que
 * la prueba verifique qué se mandó (y con qué token).
 */
import { createServer, type IncomingMessage, type Server } from "node:http";

export const VALID_TOKEN = "EAAGpruebaTokenValidoDeMeta1234";
export const PHONE_ID = "1098765432101";
export const WABA_ID = "2098765432102";
/** Número al que Meta no puede entregar (error 131026). */
export const UNDELIVERABLE = "5490000000000";

export interface Call {
  method: string;
  path: string;
  auth?: string;
  json?: Record<string, unknown>;
  headers: Record<string, string | string[] | undefined>;
  raw: string;
}

export interface MockMeta {
  calls: Call[];
  /** Simula que el token venció (Meta responde 190). */
  expired: boolean;
  /** Código que devuelve el "sistema de gestión" (200 por defecto). */
  gestionStatus: number;
  url: string;
  close(): Promise<void>;
}

const readBody = (req: IncomingMessage) =>
  new Promise<Buffer>((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });

export async function startMockMeta(port = 4010): Promise<MockMeta> {
  const templates: { id: string; name: string; language: string; status: string; category: string }[] = [];
  let seq = 0;
  const state: MockMeta = { calls: [], expired: false, gestionStatus: 200, url: `http://127.0.0.1:${port}`, close: async () => undefined };

  const server: Server = createServer(async (req, res) => {
    const buf = await readBody(req);
    const raw = buf.toString("utf8");
    const url = new URL(req.url ?? "/", state.url);
    let json: Record<string, unknown> | undefined;
    if (String(req.headers["content-type"] ?? "").includes("application/json")) json = raw ? JSON.parse(raw) : {};
    state.calls.push({ method: req.method ?? "GET", path: url.pathname, auth: req.headers.authorization, json, headers: req.headers, raw });
    const send = (status: number, body: unknown, type = "application/json") => {
      res.writeHead(status, { "content-type": type });
      res.end(type === "application/json" ? JSON.stringify(body) : (body as Buffer));
    };
    const metaError = (status: number, code: number, message: string) => send(status, { error: { message, type: "OAuthException", code, fbtrace_id: "mock" } });

    // ── Sistema de gestión simulado ──
    if (url.pathname === "/gestion") return send(state.gestionStatus, { ok: state.gestionStatus < 300 });
    // ── Archivo detrás de la URL firmada ──
    if (url.pathname.startsWith("/files/")) {
      if (req.headers.authorization !== `Bearer ${VALID_TOKEN}`) return send(401, { error: "sin token" });
      return send(200, Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]), "image/png");
    }

    // ── Graph API: /v23.0/... ──
    const [, , ...parts] = url.pathname.split("/");
    if (req.headers.authorization !== `Bearer ${VALID_TOKEN}`) return metaError(401, 190, "Invalid OAuth access token");
    if (state.expired) return metaError(401, 190, "Error validating access token: Session has expired");

    const [first, second] = parts;
    if (first === PHONE_ID && !second && req.method === "GET") {
      return send(200, { display_phone_number: "+54 9 351 999-0000", verified_name: "Distribuidora Prueba", quality_rating: "GREEN", id: PHONE_ID });
    }
    if (first !== PHONE_ID && !second && req.method === "GET" && first.startsWith("MEDIA")) {
      return send(200, { url: `${state.url}/files/${first}`, mime_type: "image/png", file_size: 7, id: first });
    }
    if (first === WABA_ID && second === "subscribed_apps") return send(200, { success: true });
    if (first === PHONE_ID && second === "media") return send(200, { id: `media.mock.${++seq}` });
    if (first === PHONE_ID && second === "messages") {
      if (json?.status === "read") return send(200, { success: true });
      if (json?.to === UNDELIVERABLE) return metaError(400, 131026, "Message undeliverable");
      return send(200, { messaging_product: "whatsapp", contacts: [{ input: json?.to, wa_id: json?.to }], messages: [{ id: `wamid.mock.${++seq}` }] });
    }
    if (first === WABA_ID && second === "message_templates") {
      if (req.method === "POST") {
        const t = { id: `tpl.${++seq}`, name: String(json?.name), language: String(json?.language), status: "PENDING", category: String(json?.category) };
        templates.push(t);
        return send(200, { id: t.id, status: t.status, category: t.category });
      }
      if (req.method === "DELETE") return send(200, { success: true });
      return send(200, { data: templates, paging: { cursors: { before: "a", after: "b" } } });
    }
    if (first?.startsWith("tpl.") && req.method === "POST") return send(200, { success: true });
    return metaError(400, 100, `Ruta no simulada: ${req.method} ${url.pathname}`);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
  state.close = () => new Promise((resolve) => server.close(() => resolve()));
  return state;
}
