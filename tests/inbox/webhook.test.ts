/**
 * Webhook real de WhatsApp (firma, enrutamiento por empresa, procesamiento)
 * contra el emulador de Firestore.   npm run test:emulador
 */
import { before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { buildInboundPayload } from "../../src/lib/whatsapp/webhook.ts";
import { seal } from "../../src/server/whatsapp/secret-box.ts";
import { sha256Hex, signBody } from "../../src/server/whatsapp/signature.ts";
import { phoneRoute, PRIMARY_ACCOUNT_ID, secretContext, wabaRoute } from "../../src/server/whatsapp/accounts-core.ts";
import { acceptWebhook, processWebhookEvent, retryWebhookEvents, verifyWebhookToken, WebhookRejected, type WebhookDeps } from "../../src/server/whatsapp/webhook-core.ts";

const app = initializeApp({ projectId: "demo-crm-whatsapp-webhook" }, "webhook-tests");
const db = getFirestore(app);
db.settings({ ignoreUndefinedProperties: true });

const PLATFORM_SECRET = "platform-secret";
const OWN_SECRET = "0123456789abcdef0123456789abcdef";
const KEY = randomBytes(32);
const A = { org: "org-a", phone: "1110001", waba: "9990001" }; // usa la app de la plataforma
const B = { org: "org-b", phone: "1110002", waba: "9990002" }; // tiene su propia app de Meta
const DEMO = { org: "demo-x", phone: "1110003", waba: "9990003" };

const stored: { orgId: string; path: string }[] = [];
let mediaFetches = 0;

/** Graph API simulado: GET /{media-id} devuelve la URL; la URL devuelve los bytes. */
const fakeGraph = (async (input: string | URL | Request) => {
  const url = String(input);
  mediaFetches += 1;
  if (url.includes("/v23.0/MEDIA-1")) return Response.json({ url: "https://lookaside.test/MEDIA-1", mime_type: "image/jpeg" });
  if (url.startsWith("https://lookaside.test/")) return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } });
  return Response.json({ error: { message: "no", code: 100 } }, { status: 400 });
}) as typeof fetch;

const deps: WebhookDeps = {
  db,
  globalAppSecret: PLATFORM_SECRET,
  globalVerifyToken: "token-plataforma",
  secretKey: KEY,
  graph: { version: "v23.0", baseUrl: "https://graph.test", fetch: fakeGraph },
  async storeMedia(orgId, conversationId, file) {
    const path = `orgs/${orgId}/conversations/${conversationId}/${file.fileName}`;
    stored.push({ orgId, path });
    return { storagePath: path, size: file.bytes.length };
  },
  now: () => Date.now(),
};

let seq = 0;
function messagePayload(phoneNumberId: string, from: string, text: string, extra: Record<string, unknown> = {}) {
  seq += 1;
  return buildInboundPayload({
    phoneNumberId,
    displayPhone: "5493510000000",
    from,
    profileName: "Cliente",
    wamid: `wamid.real.${seq}`,
    timestamp: Date.now(),
    message: { type: "text", text: { body: text }, ...extra },
  });
}
const sign = (body: string, secret = PLATFORM_SECRET) => signBody(body, secret);

async function wipe(path: string) {
  for (const d of (await db.collection(path).get()).docs) await d.ref.delete();
}

async function setupOrg(o: { org: string; phone: string; waba: string }, opts: { isDemo?: boolean; appSecret?: string } = {}) {
  const orgRef = db.collection("organizations").doc(o.org);
  for (const name of ["customers", "conversations", "leads", "activities", "notifications", "assignments", "whatsappTemplates", "auditLogs"]) {
    for (const d of (await orgRef.collection(name).get()).docs) {
      if (name === "conversations") for (const m of (await d.ref.collection("messages").get()).docs) await m.ref.delete();
      await d.ref.delete();
    }
  }
  await orgRef.set({ id: o.org, name: o.org, isDemo: !!opts.isDemo, timezone: "America/Argentina/Cordoba", currency: "ARS" });
  await orgRef.collection("whatsappAccounts").doc(PRIMARY_ACCOUNT_ID).set({ id: PRIMARY_ACCOUNT_ID, orgId: o.org, phoneNumberId: o.phone, wabaId: o.waba, tokenSet: true, webhookStatus: "sin_verificar" });
  await orgRef.collection("secrets").doc("whatsapp").set({
    accessToken: seal("EAAG-token", KEY, secretContext(o.org, "accessToken")),
    ...(opts.appSecret ? { appSecret: seal(opts.appSecret, KEY, secretContext(o.org, "appSecret")) } : {}),
    updatedAt: 0,
    updatedBy: "test",
  });
  await db.collection("whatsappRoutes").doc(phoneRoute(o.phone)).set({ orgId: o.org, accountId: PRIMARY_ACCOUNT_ID, kind: "phone", createdAt: 0 });
  await db.collection("whatsappRoutes").doc(wabaRoute(o.waba)).set({ orgId: o.org, accountId: PRIMARY_ACCOUNT_ID, kind: "waba", createdAt: 0 });
}

const messagesOf = async (org: string) => {
  const convs = await db.collection("organizations").doc(org).collection("conversations").get();
  const all = await Promise.all(convs.docs.map((c) => c.ref.collection("messages").get()));
  return all.flatMap((s) => s.docs.map((d) => d.data()));
};

/** Webhook completo: aceptar y procesar, como hace la ruta. */
async function deliver(body: string, signature = sign(body)) {
  const ids = await acceptWebhook(deps, body, signature);
  for (const id of ids) await processWebhookEvent(deps, id);
  return ids;
}

before(() => assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "Correr con npm run test:emulador"));

beforeEach(async () => {
  await wipe("webhookEvents");
  await wipe("whatsappRoutes");
  await wipe("whatsappVerifyTokens");
  await setupOrg(A);
  await setupOrg(B, { appSecret: OWN_SECRET });
  await setupOrg(DEMO, { isDemo: true });
  stored.length = 0;
  mediaFetches = 0;
});

describe("webhook de WhatsApp", () => {
  test("firma válida: se guarda el evento, se procesa y entra a la bandeja de su empresa", async () => {
    const body = JSON.stringify(messagePayload(A.phone, "5493516001111", "Hola, ¿precio?"));
    const ids = await deliver(body);
    assert.equal(ids.length, 1);
    const ev = (await db.collection("webhookEvents").doc(ids[0]).get()).data()!;
    assert.equal(ev.orgId, A.org);
    assert.equal(ev.status, "procesado");
    const msgs = await messagesOf(A.org);
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0].text, "Hola, ¿precio?");
    const conv = (await db.collection("organizations").doc(A.org).collection("conversations").doc(`${PRIMARY_ACCOUNT_ID}_5493516001111`).get()).data()!;
    assert.equal(conv.isDemo, false);
    assert.equal(conv.lastInboundWamid, msgs[0].id);
    assert.equal((await messagesOf(B.org)).length, 0);
  });

  test("firma inválida o ausente: 401 y no se guarda nada", async () => {
    const body = JSON.stringify(messagePayload(A.phone, "5493516001112", "x"));
    await assert.rejects(acceptWebhook(deps, body, sign(body, "otro")), (e: unknown) => e instanceof WebhookRejected && e.status === 401);
    await assert.rejects(acceptWebhook(deps, body, null), WebhookRejected);
    await assert.rejects(acceptWebhook(deps, "no es json", sign("no es json")), (e: unknown) => e instanceof WebhookRejected && e.status === 400);
    assert.equal((await db.collection("webhookEvents").get()).size, 0);
  });

  test("una empresa con app propia valida con SU secreto; no puede colar eventos de otra", async () => {
    const forB = JSON.stringify(messagePayload(B.phone, "5493516002222", "hola B"));
    await assert.rejects(acceptWebhook(deps, forB, sign(forB)), WebhookRejected, "B no acepta la firma de la plataforma");
    assert.equal((await deliver(forB, sign(forB, OWN_SECRET))).length, 1);

    // Payload mezclado firmado con el secreto de B: la parte de A se descarta.
    const mixed = messagePayload(B.phone, "5493516002223", "parte B");
    const partA = messagePayload(A.phone, "5493516001113", "intento de inyección en A");
    mixed.entry!.push(partA.entry![0]);
    const raw = JSON.stringify(mixed);
    const ids = await deliver(raw, sign(raw, OWN_SECRET));
    assert.equal(ids.length, 1);
    assert.equal((await messagesOf(A.org)).length, 0, "A no recibió nada");
    assert.equal((await messagesOf(B.org)).length, 2);
  });

  test("número no conectado: se registra como sin empresa y Meta recibe 200", async () => {
    const body = JSON.stringify(messagePayload("777000", "5493516003333", "x"));
    assert.deepEqual(await acceptWebhook(deps, body, sign(body)), []);
    const evs = (await db.collection("webhookEvents").get()).docs.map((d) => d.data());
    assert.deepEqual(evs.map((e) => e.status), ["sin_empresa"]);
  });

  test("el demo nunca recibe tráfico real", async () => {
    const body = JSON.stringify(messagePayload(DEMO.phone, "5493516004444", "x"));
    const [id] = await deliver(body);
    assert.equal((await db.collection("webhookEvents").doc(id).get()).data()!.status, "error");
    assert.equal((await messagesOf(DEMO.org)).length, 0);
  });

  test("idempotente: el mismo mensaje dos veces (reintento de Meta) queda una sola vez", async () => {
    const body = JSON.stringify(messagePayload(A.phone, "5493516005555", "una vez"));
    const [id] = await deliver(body);
    await deliver(body);
    await processWebhookEvent(deps, id);
    assert.equal((await messagesOf(A.org)).length, 1);
  });

  test("estados de entrega: enviado → entregado → leído, sin retroceder", async () => {
    const conv = db.collection("organizations").doc(A.org).collection("conversations").doc(`${PRIMARY_ACCOUNT_ID}_5493516006666`);
    await conv.set({ id: conv.id });
    await conv.collection("messages").doc("wamid.out.1").set({ id: "wamid.out.1", direction: "out", status: "sent" });
    const status = (s: string, ts: number) =>
      JSON.stringify({
        object: "whatsapp_business_account",
        entry: [{ id: A.waba, changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: A.phone }, statuses: [{ id: "wamid.out.1", status: s, timestamp: String(ts), recipient_id: "5493516006666" }] } }] }],
      });
    await deliver(status("read", 1_700_000_002));
    await deliver(status("delivered", 1_700_000_001));
    assert.equal((await conv.collection("messages").doc("wamid.out.1").get()).data()!.status, "read");
  });

  test("plantillas: Meta aprueba o rechaza (con motivo) por la cuenta de WhatsApp Business", async () => {
    const tpls = db.collection("organizations").doc(A.org).collection("whatsappTemplates");
    await tpls.doc("t1").set({ id: "t1", name: "seguimiento", language: "es_AR", metaStatus: "pendiente", metaTemplateId: "555" });
    await tpls.doc("t2").set({ id: "t2", name: "promo", language: "es_AR", metaStatus: "pendiente" });
    const update = (fields: Record<string, unknown>) =>
      JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: A.waba, changes: [{ field: "message_template_status_update", value: fields }] }] });
    await deliver(update({ event: "APPROVED", message_template_id: 555, message_template_name: "seguimiento", message_template_language: "es_AR", reason: "NONE" }));
    await deliver(update({ event: "REJECTED", message_template_id: 777, message_template_name: "promo", message_template_language: "es_AR", reason: "INVALID_FORMAT" }));
    assert.equal((await tpls.doc("t1").get()).data()!.metaStatus, "aprobada");
    const t2 = (await tpls.doc("t2").get()).data()!;
    assert.deepEqual([t2.metaStatus, t2.rejectedReason, t2.metaTemplateId], ["rechazada", "INVALID_FORMAT", "777"]);
    const audits = await db.collection("organizations").doc(A.org).collection("auditLogs").where("action", "==", "template.status").get();
    assert.equal(audits.size, 2);
  });

  test("archivos del cliente: se bajan de Meta con el token de la empresa y quedan en Storage", async () => {
    const body = JSON.stringify(messagePayload(A.phone, "5493516007777", "", { type: "image", text: undefined, image: { id: "MEDIA-1", mime_type: "image/jpeg", caption: "Mi pedido" } }));
    await deliver(body);
    const [msg] = await messagesOf(A.org);
    assert.equal(msg.type, "image");
    assert.equal(msg.attachments[0].mediaId, "MEDIA-1");
    assert.match(msg.attachments[0].storagePath, /^orgs\/org-a\/conversations\/principal_5493516007777\/whatsapp-.*\.jpg$/);
    assert.equal(stored.length, 1);
    assert.equal(mediaFetches, 2);
  });

  test("si falla el procesamiento queda en error y la tarea programada lo reintenta", async () => {
    const body = JSON.stringify(messagePayload(A.phone, "5493516008888", "reintento"));
    const [id] = await acceptWebhook(deps, body, sign(body));
    // Simula una caída: el evento quedó "recibido" hace 2 minutos sin procesar.
    await db.collection("webhookEvents").doc(id).update({ receivedAt: Date.now() - 120_000 });
    const r = await retryWebhookEvents(deps);
    assert.equal(r.retried, 1);
    assert.equal((await db.collection("webhookEvents").doc(id).get()).data()!.status, "procesado");
    assert.equal((await messagesOf(A.org)).length, 1);
    assert.equal((await retryWebhookEvents(deps)).retried, 0, "lo procesado no se repite");
  });

  test("verificación del webhook: token global o el de la empresa (que queda verificada)", async () => {
    assert.equal(await verifyWebhookToken(deps, "token-plataforma"), true);
    assert.equal(await verifyWebhookToken(deps, "cualquiera"), false);
    assert.equal(await verifyWebhookToken(deps, null), false);
    await db.collection("whatsappVerifyTokens").doc(sha256Hex("token-de-a")).set({ orgId: A.org, accountId: PRIMARY_ACCOUNT_ID });
    assert.equal(await verifyWebhookToken(deps, "token-de-a"), true);
    const acc = (await db.collection("organizations").doc(A.org).collection("whatsappAccounts").doc(PRIMARY_ACCOUNT_ID).get()).data()!;
    assert.equal(acc.webhookStatus, "verificado");
  });
});
