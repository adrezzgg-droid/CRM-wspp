/**
 * Motor de automatizaciones contra el emulador de Firestore.
 *   npm run test:emulador
 */
import { beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { runEventAutomations, runScheduledAutomations, type OutboundPayload } from "../../src/server/automations/engine-core.ts";
import { ingestInbound } from "../../src/server/inbox/ingest-core.ts";
import { buildInboundPayload, parseWebhook } from "../../src/lib/whatsapp/webhook.ts";

const ORG = "org-auto";
const app = initializeApp({ projectId: "demo-crm-whatsapp-auto" }, "auto-tests");
const db = getFirestore(app);
db.settings({ ignoreUndefinedProperties: true });
const org = db.collection("organizations").doc(ORG);

const sent: { to: string; payload: OutboundPayload }[] = [];
let seq = 0;
const deps = (now?: number) => ({
  db,
  now,
  send: async (_org: { isDemo: boolean }, to: string, payload: OutboundPayload) => {
    sent.push({ to, payload });
    return { wamid: `wamid.test.out.${++seq}` };
  },
});

async function clear() {
  for (const name of ["customers", "conversations", "leads", "activities", "notifications", "assignments", "members", "settings", "automations", "automationRuns", "automationJobs", "tasks", "tags", "whatsappTemplates", "orders"]) {
    for (const d of (await org.collection(name).get()).docs) {
      if (name === "conversations") for (const m of (await d.ref.collection("messages").get()).docs) await m.ref.delete();
      await d.ref.delete();
    }
  }
}

const rule = (id: string, data: Record<string, unknown>) =>
  org.collection("automations").doc(id).set({ id, orgId: ORG, isDemo: true, name: id, enabled: true, triggerParams: {}, conditions: {}, delayMinutes: 0, ...data });

async function inbound(from: string, text: string) {
  seq += 1;
  const [m] = parseWebhook(buildInboundPayload({ phoneNumberId: "pn", displayPhone: "1", from, profileName: "Cliente", wamid: `wamid.in.${seq}`, timestamp: Date.now(), message: { type: "text", text: { body: text } } })).messages;
  return ingestInbound(db, { orgId: ORG, isDemo: true, accountId: "acc" }, m);
}

beforeEach(async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "Correr con npm run test:emulador");
  await clear();
  sent.length = 0;
  await org.set({ id: ORG, name: "Org Auto", isDemo: true, status: "active", timezone: "America/Argentina/Cordoba", currency: "ARS" });
  await org.collection("members").doc("v1").set({ id: "v1", role: "vendedor", active: true, available: true, zoneIds: [], displayName: "Juan", notificationPrefs: {} });
  await org.collection("tags").doc("nuevo").set({ id: "nuevo", name: "NUEVO", color: "#000000" });
});

describe("contacto nuevo", () => {
  test("bienvenida, etiqueta y tarea; la bienvenida no cuenta como respuesta; no se repite", async () => {
    await rule("bienvenida", {
      trigger: "mensaje_nuevo_contacto",
      actions: [
        { type: "enviar_mensaje", text: "Hola {{nombre}}, te atiende {{vendedor}}." },
        { type: "agregar_etiqueta", tagId: "nuevo" },
        { type: "crear_tarea", taskType: "llamada", dueInHours: 2 },
      ],
    });
    const r = await inbound("5493518000001", "Hola");
    assert.equal(r.assigneeId, "v1");
    const ctx = { customerId: r.customerId, conversationId: r.conversationId };
    assert.deepEqual(await runEventAutomations(deps(), ORG, "mensaje_nuevo_contacto", ctx), { executed: 1, scheduled: 0 });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].payload.text, "Hola Cliente, te atiende Juan.");

    const conv = (await org.collection("conversations").doc(r.conversationId).get()).data()!;
    assert.equal(conv.awaitingReply, true, "la espera sigue: falta que responda una persona");
    assert.deepEqual(conv.tagIds, ["nuevo"]);
    assert.equal(conv.lastMessageDirection, "out");
    const tasks = (await org.collection("tasks").get()).docs.map((d) => d.data());
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].assigneeId, "v1");
    const run = (await org.collection("automationRuns").get()).docs[0].data();
    assert.equal(run.status, "ok");

    assert.deepEqual(await runEventAutomations(deps(), ORG, "mensaje_nuevo_contacto", ctx), { executed: 0, scheduled: 0 }, "idempotente");
    assert.equal(sent.length, 1);
  });

  test("condiciones: no aplica a otras etapas; plantilla sin aprobar se omite", async () => {
    await org.collection("whatsappTemplates").doc("t1").set({ id: "t1", name: "bienvenida", language: "es_AR", body: "Hola {{nombre}}", metaStatus: "borrador" });
    await rule("solo-clientes", { trigger: "mensaje_nuevo_contacto", conditions: { stages: ["cliente_activo"] }, actions: [{ type: "enviar_mensaje", text: "x" }] });
    await rule("plantilla", { trigger: "mensaje_nuevo_contacto", actions: [{ type: "enviar_mensaje", templateId: "t1" }] });
    const r = await inbound("5493518000002", "Hola");
    assert.deepEqual(await runEventAutomations(deps(), ORG, "mensaje_nuevo_contacto", { customerId: r.customerId, conversationId: r.conversationId }), { executed: 1, scheduled: 0 });
    const run = (await org.collection("automationRuns").get()).docs[0].data();
    assert.equal(run.automationId, "plantilla");
    assert.equal(run.results[0].status, "omitida");
    assert.equal(sent.length, 0);
  });
});

describe("pedido confirmado y demoras", () => {
  test("con demora se agenda y se ejecuta en la revisión periódica", async () => {
    await org.collection("customers").doc("c1").set({ id: "c1", name: "Almacén", stage: "cliente_nuevo", tagIds: [], archived: false, ownerId: "v1", stats: { ordersCount: 1, totalPurchased: 100, avgTicket: 100 } });
    await org.collection("orders").doc("o1").set({ id: "o1", number: "P-000001", total: 1000, customerId: "c1" });
    await org.collection("whatsappTemplates").doc("t2").set({ id: "t2", name: "pedido_confirmado", language: "es_AR", body: "{{nombre}}: tu pedido {{pedido}} por {{importe}} está confirmado", metaStatus: "aprobada" });
    await rule("activo", { trigger: "pedido_creado", actions: [{ type: "cambiar_estado_cliente", stage: "cliente_activo" }] });
    await rule("postventa", { trigger: "pedido_creado", delayMinutes: 60, actions: [{ type: "crear_tarea", taskType: "postventa", dueInHours: 24 }] });
    const t0 = 1_800_000_000_000;
    const res = await runEventAutomations(deps(t0), ORG, "pedido_creado", { customerId: "c1", orderId: "o1" });
    assert.deepEqual(res, { executed: 1, scheduled: 1 });
    assert.equal((await org.collection("customers").doc("c1").get()).data()!.stage, "cliente_activo");

    assert.equal((await runScheduledAutomations(deps(t0 + 30 * 60_000), ORG)).jobs, 0, "todavía no");
    assert.equal((await runScheduledAutomations(deps(t0 + 61 * 60_000), ORG)).jobs, 1);
    assert.equal((await runScheduledAutomations(deps(t0 + 120 * 60_000), ORG)).jobs, 0, "no se repite");
    assert.equal((await org.collection("tasks").get()).size, 1);
  });
});

describe("disparadores por tiempo", () => {
  test("cliente que no responde en 24 h: tarea de seguimiento, una vez", async () => {
    const now = Date.now();
    await org.collection("customers").doc("c2").set({ id: "c2", name: "Bar", stage: "prospecto", tagIds: [], archived: false, ownerId: "v1" });
    await org.collection("conversations").doc("acc_1").set({
      id: "acc_1", customerId: "c2", assigneeId: "v1", status: "en_atencion", awaitingReply: false, lastMessageDirection: "out",
      lastMessageAt: now - 25 * 3_600_000, waContactId: "1", contactName: "Bar", customerStage: "prospecto", tagIds: [],
    });
    await org.collection("conversations").doc("acc_2").set({
      id: "acc_2", customerId: "c2", assigneeId: "v1", status: "en_atencion", awaitingReply: false, lastMessageDirection: "in",
      lastMessageAt: now - 25 * 3_600_000, waContactId: "2", contactName: "Bar", customerStage: "prospecto", tagIds: [],
    });
    await rule("seguimiento", { trigger: "sin_respuesta_cliente", triggerParams: { hours: 24 }, actions: [{ type: "crear_tarea", taskType: "seguimiento", dueInHours: 0 }] });
    assert.equal((await runScheduledAutomations(deps(now), ORG)).noReply, 1, "solo la que esperaba al cliente");
    assert.equal((await runScheduledAutomations(deps(now), ORG)).noReply, 0);
    assert.equal((await org.collection("tasks").get()).docs[0].data().type, "seguimiento");
  });

  test("30 días sin comprar: para reactivar, pasa a inactivo y avisa al vendedor", async () => {
    const now = Date.now();
    await org.collection("customers").doc("c3").set({ id: "c3", name: "Kiosco", stage: "cliente_activo", tagIds: [], archived: false, ownerId: "v1", needsReactivation: false, lastPurchaseAt: now - 31 * 86_400_000 });
    await org.collection("customers").doc("c4").set({ id: "c4", name: "Reciente", stage: "cliente_activo", tagIds: [], archived: false, ownerId: "v1", needsReactivation: false, lastPurchaseAt: now - 5 * 86_400_000 });
    await rule("reactivar", { trigger: "sin_compra_dias", triggerParams: { days: 30 }, actions: [{ type: "marcar_reactivar" }] });
    assert.equal((await runScheduledAutomations(deps(now), ORG)).noPurchase, 1);
    const c3 = (await org.collection("customers").doc("c3").get()).data()!;
    assert.equal(c3.needsReactivation, true);
    assert.equal(c3.stage, "cliente_inactivo");
    assert.equal((await org.collection("customers").doc("c4").get()).data()!.needsReactivation, false);
    const n = (await org.collection("notifications").get()).docs.map((d) => d.data());
    assert.deepEqual(n.map((x) => [x.userId, x.type]), [["v1", "cliente_reactivar"]]);
    assert.equal((await runScheduledAutomations(deps(now), ORG)).noPurchase, 0, "no se repite hasta una nueva compra");
  });
});
