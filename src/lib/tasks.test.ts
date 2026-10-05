import { test } from "node:test";
import assert from "node:assert/strict";
import { dayBounds, isLate, msToZoned, taskView, zonedTimeToMs } from "./tasks.ts";

const CBA = "America/Argentina/Cordoba"; // UTC-3, sin horario de verano
const MAD = "Europe/Madrid"; // con horario de verano

test("hora local de la empresa → instante UTC", () => {
  assert.equal(zonedTimeToMs("2026-10-05", "09:30", CBA), Date.UTC(2026, 9, 5, 12, 30));
  assert.equal(zonedTimeToMs("2026-07-01", "09:00", MAD), Date.UTC(2026, 6, 1, 7, 0)); // verano UTC+2
  assert.equal(zonedTimeToMs("2026-12-01", "09:00", MAD), Date.UTC(2026, 11, 1, 8, 0)); // invierno UTC+1
});

test("ida y vuelta", () => {
  const ms = zonedTimeToMs("2026-03-29", "23:45", CBA);
  assert.deepEqual(msToZoned(ms, CBA), { date: "2026-03-29", time: "23:45" });
});

test("límites del día en la zona de la empresa", () => {
  const now = Date.UTC(2026, 9, 5, 2, 0); // 4/10 23:00 en Córdoba
  const { start, end } = dayBounds(now, CBA);
  assert.equal(start, Date.UTC(2026, 9, 4, 3, 0));
  assert.equal(end, Date.UTC(2026, 9, 5, 3, 0) - 1);
});

test("vistas: vencidas, hoy, próximas, completadas", () => {
  const now = zonedTimeToMs("2026-10-05", "12:00", CBA);
  const at = (d: string, t: string) => zonedTimeToMs(d, t, CBA);
  assert.equal(taskView({ status: "pendiente", dueAt: at("2026-10-04", "18:00") }, now, CBA), "vencidas");
  assert.equal(taskView({ status: "pendiente", dueAt: at("2026-10-05", "08:00") }, now, CBA), "hoy", "las de hoy ya pasadas siguen en Hoy");
  assert.equal(taskView({ status: "pendiente", dueAt: at("2026-10-05", "23:59") }, now, CBA), "hoy");
  assert.equal(taskView({ status: "pendiente", dueAt: at("2026-10-06", "00:00") }, now, CBA), "proximas");
  assert.equal(taskView({ status: "completada", dueAt: 0 }, now, CBA), "completadas");
  assert.equal(taskView({ status: "cancelada", dueAt: 0 }, now, CBA), null);
});

test("atrasada = pendiente con la hora pasada", () => {
  assert.equal(isLate({ status: "pendiente", dueAt: 10 }, 11), true);
  assert.equal(isLate({ status: "completada", dueAt: 10 }, 11), false);
  assert.equal(isLate({ status: "pendiente", dueAt: 12 }, 11), false);
});
