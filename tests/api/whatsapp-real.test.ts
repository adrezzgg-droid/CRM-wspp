/**
 * Integración real con WhatsApp y con el sistema de gestión, de punta a punta,
 * contra una empresa NO demo del emulador y un simulador local de Meta.
 *
 * Requiere (en otras terminales):  npm run emulators   ·   npm run dev
 * con .env.local que tenga SECRETS_ENCRYPTION_KEY, WHATSAPP_APP_SECRET,
 * CRON_SECRET y WHATSAPP_GRAPH_BASE_URL=http://127.0.0.1:4010.
 * Después:  npm run test:whatsapp
 *
 * Crea (o reinicia) la empresa "prueba-real" en el emulador. Nunca corre
 * contra un proyecto real.
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { createOrganizationDocs, ensureUser, initAdmin, isEmulator, upsertMember } from "../../scripts/lib/provision.ts";
import { PHONE_ID, startMockMeta, UNDELIVERABLE, VALID_TOKEN, WABA_ID, type MockMeta } from "../support/mock-meta.ts";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const AUTH_EMULATOR = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";
const ORG = "prueba-real";
const PASSWORD = "prueba1234";
const APP_SECRET = process.env.WHATSAPP_APP_SECRET ?? "";
const USERS = { admin: "admin@real.test", vendedor: "vendedor@real.test" } as const;
type Who = keyof typeof USERS;

const cookies = {} as Record<Who, string>;
let meta: MockMeta;
let db: Firestore;

const sign = (body: string, secret: string) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call(who: Who | null, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { Origin: BASE };
  if (who) headers.Cookie = cookies[who];
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: res.status, data: (await res.json().catch(() => ({}))) as any };
}

/** Webhook como lo manda Meta: cuerpo crudo firmado con el App Secret. */
async function webhook(payload: unknown, secret = APP_SECRET) {
  const body = JSON.stringify(payload);
  const res = await fetch(`${BASE}/api/webhooks/whatsapp`, { method: "POST", headers: { "Content-Type": "application/json", "X-Hub-Signature-256": sign(body, secret) }, body });
  return res.status;
}

const inbound = (wamid: string, from: string, message: Record<string, unknown>) => ({
  object: "whatsapp_business_account",
  entry: [
    {
      id: WABA_ID,
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "5493519990000", phone_number_id: PHONE_ID },
            contacts: [{ profile: { name: "Cliente Real" }, wa_id: from }],
            messages: [{ from, id: wamid, timestamp: String(Math.floor(Date.now() / 1000)), ...message }],
          },
        },
      ],
    },
  ],
});

/** El webhook se procesa después de responder: se espera a que aparezca. */
async function waitFor<T>(fn: () => Promise<T | null | undefined>, what: string, ms = 8000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) throw new Error(`No llegó: ${what}`);
    await sleep(200);
  }
}

async function login(who: Who) {
  const res = await fetch(`http://${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: USERS[who], password: PASSWORD, returnSecureToken: true }),
  });
  const { idToken } = (await res.json()) as { idToken: string };
  const session = await fetch(`${BASE}/api/auth/session`, { method: "POST", headers: { "Content-Type": "application/json", Origin: BASE }, body: JSON.stringify({ idToken }) });
  assert.equal(session.status, 200, await session.text());
  cookies[who] = session.headers.get("set-cookie")!.split(";")[0];
}

async function wipeOrg() {
  const org = db.collection("organizations").doc(ORG);
  for (const c of await org.listCollections()) {
    for (const d of (await c.get()).docs) {
      for (const sub of await d.ref.listCollections()) for (const x of (await sub.get()).docs) await x.ref.delete();
      await d.ref.delete();
    }
  }
  for (const name of ["whatsappRoutes", "whatsappVerifyTokens"]) {
    for (const d of (await db.collection(name).where("orgId", "==", ORG).get()).docs) await d.ref.delete();
  }
}

before(async () => {
  assert.ok(isEmulator(), "Solo contra los emuladores (.env.local)");
  assert.ok(APP_SECRET && process.env.SECRETS_ENCRYPTION_KEY && process.env.CRON_SECRET, "Faltan claves de desarrollo en .env.local");
  assert.equal(process.env.WHATSAPP_GRAPH_BASE_URL, "http://127.0.0.1:4010", "El dev server tiene que apuntar al simulador de Meta");
  const ping = await fetch(`${BASE}/login`).catch(() => null);
  assert.ok(ping?.ok, `No responde ${BASE}. Levantá emuladores y npm run dev.`);
  meta = await startMockMeta(4010);
  const admin = initAdmin();
  db = admin.db;
  await wipeOrg();
  await createOrganizationDocs(db, { id: ORG, name: "Distribuidora Prueba Real", isDemo: false });
  for (const [role, email] of Object.entries(USERS) as [Who, string][]) {
    const { uid } = await ensureUser(admin.auth, { email, displayName: role === "admin" ? "Admin Real" : "Vendedor Real", password: PASSWORD, orgId: ORG, force: true });
    await upsertMember(admin.auth, db, { uid, orgId: ORG, isDemo: false, displayName: role === "admin" ? "Admin Real" : "Vendedor Real", email, role: role === "admin" ? "admin" : "vendedor" });
  }
  await login("admin");
  await login("vendedor");
});

after(async () => {
  await meta?.close();
});

describe("WhatsApp real (contra el simulador de Meta)", () => {
  let verifyToken = "";
  const customerWa = "5493516112233";
  let conversationId = "";

  test("conectar: solo el admin; Meta rechaza un token inválido y no se guarda nada", async () => {
    const config = { phoneNumberId: PHONE_ID, wabaId: WABA_ID, accessToken: "EAAGtokenInvalidoQueMetaRechaza" };
    assert.equal((await call("vendedor", "PUT", "/api/settings/whatsapp", { ...config, accessToken: VALID_TOKEN })).status, 403);
    const bad = await call("admin", "PUT", "/api/settings/whatsapp", config);
    assert.equal(bad.status, 422, JSON.stringify(bad.data));
    assert.match(bad.data.error, /Meta no acepta/);
    assert.equal((await call("admin", "GET", "/api/settings/whatsapp")).data.account, null);

    const ok = await call("admin", "PUT", "/api/settings/whatsapp", { ...config, accessToken: VALID_TOKEN });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.equal(ok.data.account.connectionStatus, "conectado");
    assert.equal(ok.data.account.displayPhone, "+54 9 351 999-0000");
    assert.equal(ok.data.account.tokenLast4, VALID_TOKEN.slice(-4));
    assert.equal(JSON.stringify(ok.data).includes(VALID_TOKEN), false, "el token nunca vuelve al navegador");
    verifyToken = ok.data.verifyToken;
    assert.ok(verifyToken.length > 20);
    assert.ok(meta.calls.some((c) => c.path.endsWith(`/${WABA_ID}/subscribed_apps`)), "la app quedó suscripta a la cuenta");
    // En la base el token está cifrado.
    const stored = (await db.collection("organizations").doc(ORG).collection("secrets").doc("whatsapp").get()).data()!;
    assert.ok(String(stored.accessToken).startsWith("v1."));
    assert.equal(String(stored.accessToken).includes(VALID_TOKEN), false);
  });

  test("verificación del webhook con el Verify Token de la empresa", async () => {
    const q = (token: string) => `${BASE}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(token)}&hub.challenge=12345`;
    const bad = await fetch(q("otro-token"));
    assert.equal(bad.status, 403);
    const ok = await fetch(q(verifyToken));
    assert.equal(ok.status, 200);
    assert.equal(await ok.text(), "12345");
    assert.equal((await call("admin", "GET", "/api/settings/whatsapp")).data.account.webhookStatus, "verificado");
  });

  test("mensaje entrante firmado: entra a la bandeja de la empresa; sin firma válida, 401", async () => {
    assert.equal(await webhook(inbound("wamid.in.1", customerWa, { type: "text", text: { body: "Hola, ¿precio del cajón?" } }), "secreto-falso"), 401);
    assert.equal(await webhook(inbound("wamid.in.1", customerWa, { type: "text", text: { body: "Hola, ¿precio del cajón?" } })), 200);
    conversationId = `principal_${customerWa}`;
    const conv = await waitFor(async () => {
      const r = await call("admin", "GET", `/api/conversations/${conversationId}`);
      return r.status === 200 ? r.data.conversation : null;
    }, "la conversación");
    assert.equal(conv.awaitingReply, true);
    assert.equal(conv.contactName, "Cliente Real");
    // Reintento de Meta del mismo mensaje: no se duplica.
    assert.equal(await webhook(inbound("wamid.in.1", customerWa, { type: "text", text: { body: "Hola, ¿precio del cajón?" } })), 200);
  });

  test("responder: el mensaje sale por Meta con el token de la empresa", async () => {
    const before = meta.calls.length;
    const r = await call("admin", "POST", `/api/conversations/${conversationId}/messages`, { text: "¡Hola! Te paso la lista." });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.match(r.data.message.id, /^wamid\.mock\./);
    const sent = meta.calls.slice(before).find((c) => c.path.endsWith(`/${PHONE_ID}/messages`) && c.json?.type === "text");
    assert.ok(sent, "llegó a Meta");
    assert.equal(sent.auth, `Bearer ${VALID_TOKEN}`);
    assert.equal(sent.json!.to, customerWa);
    assert.deepEqual(sent.json!.text, { body: "¡Hola! Te paso la lista.", preview_url: false });

    // Meta avisa que se leyó.
    const status = {
      object: "whatsapp_business_account",
      entry: [{ id: WABA_ID, changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: PHONE_ID }, statuses: [{ id: r.data.message.id, status: "read", timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: customerWa }] } }] }],
    };
    assert.equal(await webhook(status), 200);
    await waitFor(async () => {
      const m = (await db.collection("organizations").doc(ORG).collection("conversations").doc(conversationId).collection("messages").doc(r.data.message.id).get()).data();
      return m?.status === "read" ? m : null;
    }, "el estado leído");
  });

  test("cuando la abre quien la atiende, se manda la confirmación de lectura a Meta", async () => {
    await webhook(inbound("wamid.in.2", customerWa, { type: "text", text: { body: "¿Y el envío?" } }));
    const conv = await waitFor(async () => {
      const c = (await call("admin", "GET", `/api/conversations/${conversationId}`)).data.conversation;
      return c?.unreadCount ? c : null;
    }, "el mensaje nuevo");
    // Se asignó sola al único vendedor: que la mire el admin no cuenta como leída.
    const before = meta.calls.length;
    assert.equal((await call("admin", "POST", `/api/conversations/${conversationId}/read`)).status, 200);
    assert.equal(meta.calls.slice(before).some((c) => c.json?.status === "read"), false);
    assert.ok(conv.assigneeId);
    assert.equal((await call("vendedor", "POST", `/api/conversations/${conversationId}/read`)).status, 200);
    const read = meta.calls.slice(before).find((c) => c.json?.status === "read");
    assert.equal(read?.json?.message_id, "wamid.in.2");
  });

  test("archivo del cliente: se baja de Meta al recibirlo y se abre desde el CRM", async () => {
    await webhook(inbound("wamid.in.img", customerWa, { type: "image", image: { id: "MEDIA-77", mime_type: "image/png", caption: "Así llegó" } }));
    const msg = await waitFor(async () => (await db.collection("organizations").doc(ORG).collection("conversations").doc(conversationId).collection("messages").doc("wamid.in.img").get()).data(), "la imagen");
    assert.ok(msg.attachments[0].storagePath, "quedó en Storage");
    const file = await fetch(`${BASE}/api/conversations/${conversationId}/messages/wamid.in.img/media?i=0`, { headers: { Cookie: cookies.admin } });
    assert.equal(file.status, 200);
    assert.deepEqual([...new Uint8Array(await file.arrayBuffer())].slice(0, 4), [0x89, 0x50, 0x4e, 0x47]);
  });

  test("los errores de Meta llegan traducidos (número que no puede recibir)", async () => {
    await webhook(inbound("wamid.in.x", UNDELIVERABLE, { type: "text", text: { body: "hola" } }));
    const id = `principal_${UNDELIVERABLE}`;
    await waitFor(async () => ((await call("admin", "GET", `/api/conversations/${id}`)).status === 200 ? true : null), "la conversación");
    const r = await call("admin", "POST", `/api/conversations/${id}/messages`, { text: "hola" });
    assert.equal(r.status, 422);
    assert.match(r.data.error, /no puede recibir/);
  });

  test("plantillas: se envían a Meta, quedan en revisión y la aprobación llega por webhook", async () => {
    const created = await call("admin", "POST", "/api/templates", { name: "seguimiento_real", category: "marketing", language: "es_AR", body: "Hola {{nombre}}, soy {{vendedor}}. ¿Pudiste ver la propuesta?" });
    assert.equal(created.status, 200, JSON.stringify(created.data));
    const id = created.data.template.id;
    assert.equal((await call("admin", "POST", `/api/templates/${id}/status`, { metaStatus: "aprobada" })).status, 409, "fuera del demo la aprobación no se simula");
    const sub = await call("admin", "POST", `/api/templates/${id}/submit`);
    assert.equal(sub.status, 200, JSON.stringify(sub.data));
    assert.equal(sub.data.template.metaStatus, "pendiente");
    const sentToMeta = meta.calls.find((c) => c.path.endsWith(`/${WABA_ID}/message_templates`) && c.method === "POST");
    assert.deepEqual(sentToMeta!.json!.components, [{ type: "BODY", text: "Hola {{1}}, soy {{2}}. ¿Pudiste ver la propuesta?", example: { body_text: [["José", "Juan"]] } }]);
    assert.equal((await call("admin", "PATCH", `/api/templates/${id}`, { name: "otro_nombre", category: "marketing", language: "es_AR", body: "x" })).status, 409, "enviada: no se renombra");

    const approval = {
      object: "whatsapp_business_account",
      entry: [{ id: WABA_ID, changes: [{ field: "message_template_status_update", value: { event: "APPROVED", message_template_id: sub.data.template.metaTemplateId, message_template_name: "seguimiento_real", message_template_language: "es_AR", reason: "NONE" } }] }],
    };
    assert.equal(await webhook(approval), 200);
    await waitFor(async () => ((await call("admin", "GET", "/api/templates")).data.items?.find((t: { id: string; metaStatus: string }) => t.id === id)?.metaStatus === "aprobada" ? true : null), "la aprobación");

    // Ya aprobada, se puede mandar fuera de la ventana de 24 h.
    const before = meta.calls.length;
    const sent = await call("admin", "POST", `/api/conversations/${conversationId}/template`, { templateId: id, values: { nombre: "Cliente", vendedor: "Admin" } });
    assert.equal(sent.status, 200, JSON.stringify(sent.data));
    const tpl = meta.calls.slice(before).find((c) => c.json?.type === "template");
    assert.deepEqual(tpl!.json!.template, { name: "seguimiento_real", language: { code: "es_AR" }, components: [{ type: "body", parameters: [{ type: "text", text: "Cliente" }, { type: "text", text: "Admin" }] }] });
    const sync = await call("admin", "POST", "/api/templates/sync");
    assert.equal(sync.status, 200);
  });

  test("token vencido: el envío falla con un mensaje claro y la cuenta queda con error", async () => {
    meta.expired = true;
    try {
      const r = await call("admin", "POST", `/api/conversations/${conversationId}/messages`, { text: "hola" });
      assert.equal(r.status, 503);
      assert.match(r.data.error, /token/i);
      const view = (await call("admin", "GET", "/api/settings/whatsapp")).data;
      assert.equal(view.account.connectionStatus, "error");
    } finally {
      meta.expired = false;
    }
    const fixed = await call("admin", "POST", "/api/settings/whatsapp/test");
    assert.equal(fixed.status, 200);
    assert.equal(fixed.data.account.connectionStatus, "conectado");
  });
});

describe("conector con el sistema de gestión (contra el simulador)", () => {
  let secret = "";
  let orderId = "";

  test("configurar: solo el admin; no se aceptan direcciones internas", async () => {
    const cfg = { enabled: true, url: `${meta.url}/gestion`, events: ["order.confirmed", "order.cancelled"] };
    assert.equal((await call("vendedor", "PUT", "/api/settings/integrations", cfg)).status, 403);
    assert.equal((await call("admin", "PUT", "/api/settings/integrations", { ...cfg, url: "https://10.0.0.1/x" })).status, 422);
    const ok = await call("admin", "PUT", "/api/settings/integrations", cfg);
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    secret = ok.data.gestion.secret;
    assert.ok(secret.length >= 40);
    assert.equal((await call("admin", "POST", "/api/settings/integrations/test")).status, 200, "la prueba (ping) llega");
  });

  test("pedido confirmado → se encola → la tarea programada lo entrega firmado", async () => {
    const product = (await call("admin", "POST", "/api/products", { name: "Pollo entero", sku: `POL${Date.now() % 100000}`, unit: "kg", price: 3200 })).data.product.id;
    const customerId = (await call("admin", "GET", `/api/conversations/principal_5493516112233`)).data.conversation.customerId;
    const order = await call("admin", "POST", "/api/orders", { customerId, items: [{ productId: product, qty: 10 }], confirm: true });
    assert.equal(order.status, 200, JSON.stringify(order.data));
    orderId = order.data.order.id;
    const before = meta.calls.length;
    const cron = await fetch(`${BASE}/api/cron/sla`, { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } });
    assert.equal(cron.status, 200);
    const delivered = meta.calls.slice(before).find((c) => c.path === "/gestion" && c.headers["x-crm-event"] === "order.confirmed");
    assert.ok(delivered, "llegó al sistema de gestión");
    assert.equal(delivered.headers["x-crm-signature"], sign(delivered.raw, secret), "firmado con el secreto compartido");
    const body = JSON.parse(delivered.raw);
    assert.equal(body.data.orderId, orderId);
    assert.equal(body.data.total, 32000);
    // Lo que necesita el sistema de gestión para reconocer el pedido (ver docs/CONECTOR-GESTION.md).
    assert.match(body.data.items[0].sku, /^POL\d+$/, "el código del producto");
    assert.equal(body.data.customerPhone, "5493516112233", "el teléfono del cliente");
    assert.ok([USERS.admin, USERS.vendedor].includes(body.data.sellerEmail), "el email del vendedor");
    const view = (await call("admin", "GET", "/api/settings/integrations")).data;
    assert.equal(view.outbox.find((o: { number: string }) => o.number === order.data.order.number)?.status, "enviado");
  });

  test("el sistema de gestión informa el reparto (firmado) y el pedido avanza sin eco", async () => {
    const path = `/api/integrations/gestion/${ORG}`;
    const body = JSON.stringify({ data: { orderId, status: "entregado", externalId: "G-77" } });
    const bad = await fetch(`${BASE}${path}`, { method: "POST", headers: { "Content-Type": "application/json", "X-CRM-Signature": sign(body, "otro") }, body });
    assert.equal(bad.status, 401);
    const ok = await fetch(`${BASE}${path}`, { method: "POST", headers: { "Content-Type": "application/json", "X-CRM-Signature": sign(body, secret) }, body });
    assert.equal(ok.status, 200, await ok.clone().text());
    assert.equal((await ok.json()).status, "entregado");
    const order = (await call("admin", "GET", `/api/orders/${orderId}`)).data.order;
    assert.equal(order.status, "entregado", "pasó por preparación y reparto hasta entregado");
    assert.equal(order.deliveryRef.externalId, "G-77");
    const outbox = (await call("admin", "GET", "/api/settings/integrations")).data.outbox as { event: string }[];
    assert.equal(outbox.length, 1, "no se le devolvió nada al sistema de gestión");
  });

  test("desconectar WhatsApp: un webhook posterior ya no entra a la empresa", async () => {
    assert.equal((await call("vendedor", "DELETE", "/api/settings/whatsapp")).status, 403);
    assert.equal((await call("admin", "DELETE", "/api/settings/whatsapp")).status, 200);
    assert.equal(await webhook(inbound("wamid.in.after", "5493516999999", { type: "text", text: { body: "¿Hola?" } })), 200);
    await sleep(800);
    assert.equal((await call("admin", "GET", "/api/conversations/principal_5493516999999")).status, 404);
  });
});
