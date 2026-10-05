import { test } from "node:test";
import assert from "node:assert/strict";
import { advanceLead, pickAssignee, slaBreached, waitingMinutes, type Candidate } from "./assignment.ts";

const v = (id: string, extra: Partial<Candidate> = {}): Candidate => ({ id, role: "vendedor", active: true, available: true, zoneIds: [], ...extra });
const opts = { useZones: true, zoneFallback: true };

test("turno rotativo: el que hace más que no recibe; empate por id", () => {
  const list = [v("b", { lastAutoAssignedAt: 200 }), v("a", { lastAutoAssignedAt: 100 }), v("c", { lastAutoAssignedAt: 300 })];
  assert.deepEqual(pickAssignee(list, opts), { id: "a", reason: "regla_nuevo" });
  assert.equal(pickAssignee([v("z"), v("y")], opts)?.id, "y", "nunca asignados: orden estable");
  assert.equal(pickAssignee([v("x", { lastAutoAssignedAt: 5 }), v("w")], opts)?.id, "w", "el que nunca recibió va primero");
});

test("solo vendedores activos y disponibles", () => {
  const list = [v("a", { available: false }), v("b", { active: false }), v("s", { role: "supervisor" }), v("ok", { lastAutoAssignedAt: 999 })];
  assert.equal(pickAssignee(list, opts)?.id, "ok");
  assert.equal(pickAssignee([v("a", { available: false })], opts), null);
});

test("zona: prioriza a quien la cubre", () => {
  const list = [v("centro", { zoneIds: ["centro"], lastAutoAssignedAt: 999 }), v("norte", { zoneIds: ["norte"] })];
  assert.deepEqual(pickAssignee(list, { ...opts, zoneId: "centro" }), { id: "centro", reason: "regla_zona" });
});

test("zona sin vendedor: cae al general solo si está permitido", () => {
  const list = [v("norte", { zoneIds: ["norte"] })];
  assert.deepEqual(pickAssignee(list, { ...opts, zoneId: "sur" }), { id: "norte", reason: "regla_nuevo" });
  assert.equal(pickAssignee(list, { useZones: true, zoneFallback: false, zoneId: "sur" }), null);
  assert.equal(pickAssignee(list, { useZones: false, zoneFallback: false, zoneId: "sur" })?.reason, "regla_nuevo");
});

test("demora: cuenta desde el primer mensaje sin respuesta y avisa una sola vez", () => {
  const base = { awaitingReply: true, awaitingSince: 0, status: "pendiente" };
  assert.equal(slaBreached(base, 15, 14 * 60_000), false);
  assert.equal(slaBreached(base, 15, 15 * 60_000), true);
  assert.equal(slaBreached({ ...base, slaAlertedAt: 16 * 60_000 }, 15, 20 * 60_000), false);
  assert.equal(slaBreached({ ...base, awaitingSince: 30 * 60_000, slaAlertedAt: 16 * 60_000 }, 15, 46 * 60_000), true, "nueva espera, nuevo aviso");
  assert.equal(slaBreached({ ...base, awaitingReply: false }, 15, 99 * 60_000), false);
  assert.equal(slaBreached({ ...base, status: "cerrada" }, 15, 99 * 60_000), false);
  assert.equal(waitingMinutes(0, 90_000), 1);
});

test("el lead nunca retrocede por un evento automático", () => {
  assert.equal(advanceLead("recibido", "asignado"), "asignado");
  assert.equal(advanceLead("en_negociacion", "asignado"), "en_negociacion");
  assert.equal(advanceLead("asignado", "contactado"), "contactado");
  assert.equal(advanceLead("perdido", "contactado"), "perdido");
});
