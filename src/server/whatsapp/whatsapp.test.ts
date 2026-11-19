import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { lastFour, open, parseKey, seal, SecretBoxError } from "./secret-box.ts";
import { sha256Hex, signBody, verifySignature } from "./signature.ts";
import {
  createTemplate,
  downloadMedia,
  explainGraphError,
  GraphError,
  listTemplates,
  mapTemplateStatus,
  mediaPayload,
  sendMessage,
  templatePayload,
  textPayload,
  uploadMedia,
  type GraphConfig,
} from "./graph.ts";

// ───────────────────────────── Cifrado ──────────────────────────────────────

test("secretos: se descifran solo con la misma clave y el mismo contexto", () => {
  const key = randomBytes(32);
  const sealed = seal("EAAG-token-secreto", key, "org-1:whatsapp.accessToken");
  assert.ok(!sealed.includes("EAAG"), "no queda en claro");
  assert.notEqual(sealed, seal("EAAG-token-secreto", key, "org-1:whatsapp.accessToken"), "IV aleatorio");
  assert.equal(open(sealed, key, "org-1:whatsapp.accessToken"), "EAAG-token-secreto");
  assert.throws(() => open(sealed, key, "org-2:whatsapp.accessToken"), SecretBoxError, "copiado a otra empresa");
  assert.throws(() => open(sealed, randomBytes(32), "org-1:whatsapp.accessToken"), SecretBoxError, "otra clave");
  const [v, iv, tag, ct] = sealed.split(".");
  const tampered = [v, iv, tag, ct.slice(0, -2) + (ct.endsWith("A") ? "BB" : "AA")].join(".");
  assert.throws(() => open(tampered, key, "org-1:whatsapp.accessToken"), SecretBoxError, "alterado");
});

test("clave de cifrado: obligatoria y de 32 bytes", () => {
  assert.throws(() => parseKey(undefined), /SECRETS_ENCRYPTION_KEY/);
  assert.throws(() => parseKey(Buffer.alloc(16).toString("base64")), /32 bytes/);
  assert.equal(parseKey(randomBytes(32).toString("base64")).length, 32);
  assert.equal(lastFour("EAAGabcdefgh1234"), "1234");
  assert.equal(lastFour("corto"), "");
});

// ───────────────────────────── Firma ────────────────────────────────────────

test("firma del webhook: sobre el cuerpo crudo, comparación estricta", () => {
  const body = '{"object":"whatsapp_business_account","entry":[]}';
  const header = signBody(body, "app-secret");
  assert.match(header, /^sha256=[0-9a-f]{64}$/);
  assert.equal(verifySignature(body, header, "app-secret"), true);
  assert.equal(verifySignature(body, header.toUpperCase().replace("SHA256", "sha256"), "app-secret"), true, "hex en mayúsculas");
  assert.equal(verifySignature(body + " ", header, "app-secret"), false, "un byte distinto");
  assert.equal(verifySignature(body, header, "otro-secreto"), false);
  assert.equal(verifySignature(body, null, "app-secret"), false);
  assert.equal(verifySignature(body, "sha1=abc", "app-secret"), false);
  assert.equal(verifySignature(body, header, undefined), false, "sin secreto configurado nunca es válido");
  assert.equal(sha256Hex("abc").length, 64);
});

// ───────────────────────────── Graph API ────────────────────────────────────

type Call = { url: string; method: string; headers: Record<string, string>; body?: unknown };

function fakeFetch(responses: ((call: Call) => { status?: number; json?: unknown; bytes?: Uint8Array; contentType?: string })[]) {
  const calls: Call[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const call: Call = { url: String(input), method: init?.method ?? "GET", headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body };
    calls.push(call);
    const r = responses[calls.length - 1]?.(call) ?? { status: 500, json: {} };
    if (r.bytes) return new Response(new Uint8Array(r.bytes), { status: r.status ?? 200, headers: { "content-type": r.contentType ?? "application/octet-stream" } });
    return new Response(JSON.stringify(r.json ?? {}), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { impl, calls };
}

const cfg = (f: typeof fetch): GraphConfig => ({ token: "TOKEN", version: "v23.0", baseUrl: "https://graph.test", fetch: f });

test("envío: texto, plantilla y archivo con la forma que pide Meta", async () => {
  assert.deepEqual(textPayload("549351", "hola").text, { body: "hola", preview_url: false });
  assert.equal(textPayload("549351", "mirá https://x.com").text.preview_url, true);
  assert.deepEqual(templatePayload("549351", { name: "seguimiento", language: "es_AR", params: ["José", "Juan"] }).template, {
    name: "seguimiento",
    language: { code: "es_AR" },
    components: [{ type: "body", parameters: [{ type: "text", text: "José" }, { type: "text", text: "Juan" }] }],
  });
  assert.equal("components" in templatePayload("549351", { name: "hola", language: "es_AR", params: [] }).template, false);
  assert.deepEqual(mediaPayload("549351", "document", "M1", { caption: "Lista", fileName: "precios.pdf" }).document, { id: "M1", caption: "Lista", filename: "precios.pdf" });
  assert.deepEqual(mediaPayload("549351", "audio", "M2", { caption: "no va", fileName: "no va" }).audio, { id: "M2" });

  const { impl, calls } = fakeFetch([() => ({ json: { messages: [{ id: "wamid.REAL" }] } })]);
  assert.deepEqual(await sendMessage(cfg(impl), "PN1", textPayload("549351", "hola")), { wamid: "wamid.REAL" });
  assert.equal(calls[0].url, "https://graph.test/v23.0/PN1/messages");
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].headers.Authorization, "Bearer TOKEN");
});

test("archivos: subida multipart y descarga en dos pasos con el token", async () => {
  const up = fakeFetch([() => ({ json: { id: "MEDIA-1" } })]);
  assert.equal(await uploadMedia(cfg(up.impl), "PN1", { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png", fileName: "a.png" }), "MEDIA-1");
  assert.ok(up.calls[0].body instanceof FormData);
  assert.equal((up.calls[0].body as FormData).get("messaging_product"), "whatsapp");

  const down = fakeFetch([
    () => ({ json: { url: "https://lookaside.test/file?sig=1", mime_type: "image/jpeg" } }),
    (call) => {
      assert.equal(call.headers.Authorization, "Bearer TOKEN", "la URL firmada también pide el token");
      return { bytes: new Uint8Array([9, 9]), contentType: "image/jpeg" };
    },
  ]);
  const file = await downloadMedia(cfg(down.impl), "MEDIA-9");
  assert.deepEqual([...file.bytes], [9, 9]);
  assert.equal(file.mimeType, "image/jpeg");
  assert.equal(down.calls[0].url, "https://graph.test/v23.0/MEDIA-9");
});

test("plantillas: alta con ejemplos, listado paginado y estados", async () => {
  const create = fakeFetch([() => ({ json: { id: "T1", status: "PENDING" } })]);
  await createTemplate(cfg(create.impl), "WABA", { name: "seguimiento", language: "es_AR", category: "marketing", metaText: "Hola {{1}}, soy {{2}}", examples: ["José", "Juan"] });
  assert.deepEqual(JSON.parse(String(create.calls[0].body)), {
    name: "seguimiento",
    language: "es_AR",
    category: "MARKETING",
    components: [{ type: "BODY", text: "Hola {{1}}, soy {{2}}", example: { body_text: [["José", "Juan"]] } }],
  });

  const list = fakeFetch([
    () => ({ json: { data: [{ id: "1", name: "a", language: "es_AR", status: "APPROVED" }], paging: { cursors: { after: "C1" }, next: "https://next" } } }),
    (call) => {
      assert.match(call.url, /after=C1/);
      return { json: { data: [{ id: "2", name: "b", language: "es_AR", status: "REJECTED" }], paging: { cursors: { after: "C2" } } } };
    },
  ]);
  assert.deepEqual((await listTemplates(cfg(list.impl), "WABA")).map((t) => t.id), ["1", "2"]);
  assert.deepEqual(["APPROVED", "PENDING", "IN_APPEAL", "REJECTED", "PAUSED", "DISABLED"].map(mapTemplateStatus), ["aprobada", "pendiente", "pendiente", "rechazada", "rechazada", "rechazada"]);
});

test("errores de Meta: se traducen y el token vencido pide reconectar", async () => {
  const { impl } = fakeFetch([() => ({ status: 400, json: { error: { message: "Re-engagement message", code: 131047 } } })]);
  const err = await sendMessage(cfg(impl), "PN1", textPayload("1", "x")).catch((e) => e);
  assert.ok(err instanceof GraphError);
  assert.equal(err.code, 131047);
  assert.equal(explainGraphError(err).status, 409);
  const expired = explainGraphError(new GraphError(401, { code: 190, message: "Session has expired" }, ""));
  assert.equal(expired.reconnect, true);
  assert.equal(expired.status, 503);
  assert.match(explainGraphError(new GraphError(400, { code: 100, message: "Invalid", error_user_msg: "El nombre ya existe" }, "")).message, /El nombre ya existe/);
  assert.equal(explainGraphError(Object.assign(new Error("t"), { name: "TimeoutError" })).status, 504);
});
