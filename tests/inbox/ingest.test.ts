/**
 * Ingestión de mensajes entrantes contra el emulador de Firestore.
 *   npm run test:emulador
 */
import { before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { applyStatus, ingestInbound, conversationIdFor } from "../../src/server/inbox/ingest-core.ts";
import { parseWebhook, buildInboundPayload, type InboundMessage } from "../../src/lib/whatsapp/webhook.ts";

const ORG = "org-ingest";
const ACCOUNT = "acc1";
const target = { orgId: ORG, isDemo: true, accountId: ACCOUNT };

const app = initializeApp({ projectId: "demo-crm-whatsapp-ingest" }, "ingest-tests");
const db = getFirestore(app);
db.settings({ ignoreUndefinedProperties: true });
const org = db.collection("organizations").doc(ORG);

let seq = 0;
function inbound(from: string, text: string, extra: Partial<InboundMessage> = {}): InboundMessage {
  seq += 1;
  const [m] = parseWebhook(
    buildInboundPayload({
      phoneNumberId: "pn1",
      displayPhone: "5493510000000",
      from,
      profileName: "Cliente Prueba",
      wamid: `wamid.test.${seq}`,
      timestamp: 1_700_000_000_000 + seq * 1000,
      message: { type: "text", text: { body: text } },
    }),
  ).messages;
  return { ...m, ...extra };
}

async function clear() {
  for (const name of ["customers", "conversations", "leads", "activities", "notifications", "assignments", "members"]) {
    const snap = await org.collection(name).get();
    for (const d of snap.docs) {
      if (name === "conversations") for (const m of (await d.ref.collection("messages").get()).docs) await m.ref.delete();
      await d.ref.delete();
    }
  }
}

const member = (id: string, role: string, extra: Record<string, unknown> = {}) =>
  org.collection("members").doc(id).set({ id, role, displayName: id.toUpperCase(), active: true, notificationPrefs: {}, ...extra });

before(async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "Correr con npm run test:emulador");
});

beforeEach(async () => {
  await clear();
  await member("adm", "admin");
  await member("sup", "supervisor");
  await member("v1", "vendedor");
  await member("v2", "vendedor", { notificationPrefs: { nuevo_mensaje: false } });
});

describe("número nuevo", () => {
  test("crea cliente prospecto, lead, conversación y mensaje; avisa a admin y supervisor", async () => {
    const r = await ingestInbound(db, target, inbound("5493516000001", "Hola, ¿precio?"));
    assert.equal(r.duplicate, false);
    assert.equal(r.newCustomer, true);
    assert.equal(r.newConversation, true);
    assert.equal(r.conversationId, conversationIdFor(ACCOUNT, "5493516000001"));

    const customer = (await org.collection("customers").doc(r.customerId).get()).data()!;
    assert.equal(customer.stage, "prospecto");
    assert.equal(customer.name, "Cliente Prueba");
    assert.equal(customer.ownerId, null);
    assert.ok(customer.searchKeywords.includes("6000001".slice(0, 4)) || customer.searchKeywords.includes("0001"));

    const conv = (await org.collection("conversations").doc(r.conversationId).get()).data()!;
    assert.equal(conv.status, "nueva");
    assert.equal(conv.assigneeId, null);
    assert.equal(conv.unreadCount, 1);
    assert.equal(conv.awaitingReply, true);
    assert.equal(conv.lastMessagePreview, "Hola, ¿precio?");
    assert.equal(conv.serviceWindowEndsAt, conv.lastInboundAt + 24 * 3600 * 1000);
    assert.ok(conv.leadId);

    const lead = (await org.collection("leads").doc(conv.leadId).get()).data()!;
    assert.equal(lead.status, "recibido");

    const notified = (await org.collection("notifications").get()).docs.map((d) => d.data().userId).sort();
    assert.deepEqual(notified, ["adm", "sup"]);
  });
});

describe("idempotencia y orden", () => {
  test("el mismo wamid dos veces no duplica nada", async () => {
    const m = inbound("5493516000002", "Hola");
    await ingestInbound(db, target, m);
    const again = await ingestInbound(db, target, m);
    assert.equal(again.duplicate, true);
    const conv = (await org.collection("conversations").doc(again.conversationId).get()).data()!;
    assert.equal(conv.unreadCount, 1);
    assert.equal((await org.collection("conversations").doc(again.conversationId).collection("messages").get()).size, 1);
    assert.equal((await org.collection("customers").get()).size, 1);
  });

  test("varios mensajes: un solo lead, no leídos acumulados, un solo aviso", async () => {
    const r1 = await ingestInbound(db, target, inbound("5493516000003", "uno"));
    await ingestInbound(db, target, inbound("5493516000003", "dos"));
    await ingestInbound(db, target, inbound("5493516000003", "tres"));
    const conv = (await org.collection("conversations").doc(r1.conversationId).get()).data()!;
    assert.equal(conv.unreadCount, 3);
    assert.equal(conv.lastMessagePreview, "tres");
    assert.equal((await org.collection("leads").get()).size, 1);
    assert.equal((await org.collection("notifications").get()).size, 2); // admin + supervisor, una vez
  });

  test("un mensaje viejo que llega tarde no pisa la vista previa", async () => {
    const late = inbound("5493516000004", "viejo");
    const r = await ingestInbound(db, target, inbound("5493516000004", "nuevo"));
    await ingestInbound(db, target, { ...late, timestamp: late.timestamp - 60_000 });
    const conv = (await org.collection("conversations").doc(r.conversationId).get()).data()!;
    assert.equal(conv.lastMessagePreview, "nuevo");
  });
});

describe("cliente existente", () => {
  test("cliente con vendedor: la conversación queda asignada y solo él recibe el aviso", async () => {
    await org.collection("customers").doc("c1").set({ id: "c1", name: "Pollería", whatsappId: "5493516000005", ownerId: "v1", stage: "cliente_activo", tagIds: [], archived: false });
    const r = await ingestInbound(db, target, inbound("5493516000005", "quiero hacer un pedido"));
    assert.equal(r.newCustomer, false);
    assert.equal(r.customerId, "c1");
    const conv = (await org.collection("conversations").doc(r.conversationId).get()).data()!;
    assert.equal(conv.assigneeId, "v1");
    assert.equal(conv.contactName, "Pollería");
    assert.equal(conv.leadId, undefined, "un cliente activo no es un lead nuevo");
    const assignments = (await org.collection("assignments").get()).docs.map((d) => d.data());
    assert.equal(assignments[0].reason, "cliente_existente");
    const notified = (await org.collection("notifications").get()).docs.map((d) => d.data());
    assert.deepEqual(notified.map((n) => n.userId), ["v1"]);
    assert.equal(notified[0].type, "nuevo_mensaje");
  });

  test("respeta las preferencias de aviso del vendedor", async () => {
    await org.collection("customers").doc("c2").set({ id: "c2", name: "Almacén", whatsappId: "5493516000006", ownerId: "v2", stage: "cliente_activo", tagIds: [], archived: false });
    await ingestInbound(db, target, inbound("5493516000006", "hola"));
    assert.equal((await org.collection("notifications").get()).size, 0);
  });

  test("una conversación cerrada se reabre como pendiente", async () => {
    const r = await ingestInbound(db, target, inbound("5493516000007", "hola"));
    await org.collection("conversations").doc(r.conversationId).update({ status: "cerrada", closedAt: 1, awaitingReply: false });
    const again = await ingestInbound(db, target, inbound("5493516000007", "volví"));
    assert.equal(again.reopened, true);
    const conv = (await org.collection("conversations").doc(r.conversationId).get()).data()!;
    assert.equal(conv.status, "pendiente");
    assert.equal(conv.closedAt, undefined);
    const kinds = (await org.collection("activities").get()).docs.map((d) => d.data().kind);
    assert.ok(kinds.includes("conversacion.reabierta"));
  });
});

describe("estados de entrega", () => {
  test("solo avanzan: enviado → entregado → leído", async () => {
    const r = await ingestInbound(db, target, inbound("5493516000008", "hola"));
    const out = org.collection("conversations").doc(r.conversationId).collection("messages").doc("wamid.out1");
    await out.set({ id: "wamid.out1", direction: "out", status: "sent" });
    const s = (status: "delivered" | "read" | "sent") => applyStatus(db, target, { phoneNumberId: "pn1", wamid: "wamid.out1", status, timestamp: Date.now(), recipient: "5493516000008" });
    assert.equal(await s("read"), true);
    assert.equal(await s("delivered"), false);
    assert.equal((await out.get()).data()!.status, "read");
    assert.equal(await applyStatus(db, target, { phoneNumberId: "pn1", wamid: "no-existe", status: "read", timestamp: 1, recipient: "5493516000008" }), false);
  });
});
