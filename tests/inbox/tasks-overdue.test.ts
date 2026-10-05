/**
 * Avisos de tareas vencidas contra el emulador de Firestore.
 *   npm run test:emulador
 */
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { runOverdueTasks } from "../../src/server/tasks/overdue-core.ts";

const ORG = "org-tasks";
const app = initializeApp({ projectId: "demo-crm-whatsapp-tasks" }, "tasks-tests");
const db = getFirestore(app);
db.settings({ ignoreUndefinedProperties: true });
const org = db.collection("organizations").doc(ORG);

async function clear() {
  for (const name of ["tasks", "members", "notifications"]) {
    for (const d of (await org.collection(name).get()).docs) await d.ref.delete();
  }
}

const task = (id: string, assigneeId: string, dueAt: number, extra: Record<string, unknown> = {}) =>
  org.collection("tasks").doc(id).set({ id, orgId: ORG, isDemo: true, assigneeId, type: "llamada", priority: "normal", status: "pendiente", dueAt, customerName: "Cliente", ...extra });

beforeEach(async () => {
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "Correr con npm run test:emulador");
  await clear();
  await org.collection("members").doc("v1").set({ id: "v1", role: "vendedor", active: true, notificationPrefs: {} });
  await org.collection("members").doc("v2").set({ id: "v2", role: "vendedor", active: true, notificationPrefs: { tarea_vencida: false } });
});

test("avisa una vez por tarea vencida y respeta las preferencias", async () => {
  const now = 1_000_000_000;
  await task("t1", "v1", now - 60_000);
  await task("t2", "v1", now + 60_000); // todavía no vence
  await task("t3", "v2", now - 60_000); // v2 no quiere avisos
  await task("t4", "v1", now - 60_000, { status: "completada" });

  const first = await runOverdueTasks(db, ORG, now);
  assert.equal(first.notified, 1);
  const notes = (await org.collection("notifications").get()).docs.map((d) => d.data());
  assert.deepEqual(notes.map((n) => [n.userId, n.type]), [["v1", "tarea_vencida"]]);
  assert.ok((await org.collection("tasks").doc("t3").get()).data()!.overdueNotifiedAt, "se marca aunque no se avise");

  const second = await runOverdueTasks(db, ORG, now + 3_600_000);
  assert.equal(second.notified, 1, "solo la que venció recién (t2)");
  assert.equal((await org.collection("notifications").get()).size, 2);
});

test("una tarea reprogramada vuelve a avisar si vence otra vez", async () => {
  const now = 2_000_000_000;
  await task("t1", "v1", now - 60_000);
  await runOverdueTasks(db, ORG, now);
  // Reprogramar borra la marca (lo hace el servicio al cambiar la fecha).
  await org.collection("tasks").doc("t1").update({ dueAt: now + 60_000, overdueNotifiedAt: FieldValue.delete() });
  assert.equal((await runOverdueTasks(db, ORG, now + 120_000)).notified, 1);
});
