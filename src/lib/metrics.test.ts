import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bucketKeys,
  bucketLabel,
  formatMinutes,
  inRange,
  leadReach,
  median,
  niceTicks,
  PeriodError,
  resolvePeriod,
  responseMinutes,
  seriesBy,
  summarizeLeads,
  summarizeSales,
  type LeadRow,
} from "./metrics.ts";
import { zonedTimeToMs } from "./tasks.ts";

const TZ = "America/Argentina/Cordoba"; // UTC-3, sin horario de verano
const at = (date: string, time = "00:00") => zonedTimeToMs(date, time, TZ);
const NOW = at("2026-11-18", "14:30"); // miércoles

test("período: hoy se compara con ayer hasta la misma hora", () => {
  const p = resolvePeriod("hoy", NOW, TZ);
  assert.equal(p.from, at("2026-11-18"));
  assert.equal(p.to, at("2026-11-19"));
  assert.equal(p.partial, true);
  assert.equal(p.bucket, "hora");
  assert.equal(p.previous.from, at("2026-11-17"));
  assert.equal(p.previous.to, at("2026-11-17", "14:30"));
});

test("período: ayer, completo contra anteayer completo", () => {
  const p = resolvePeriod("ayer", NOW, TZ);
  assert.deepEqual([p.firstDay, p.lastDay, p.partial], ["2026-11-17", "2026-11-17", false]);
  assert.deepEqual([p.previous.from, p.previous.to], [at("2026-11-16"), at("2026-11-17")]);
});

test("período: últimos 7 y 30 días incluyen hoy", () => {
  const p7 = resolvePeriod("7d", NOW, TZ);
  assert.deepEqual([p7.firstDay, p7.lastDay, p7.days, p7.bucket], ["2026-11-12", "2026-11-18", 7, "dia"]);
  assert.deepEqual([p7.previous.firstDay, p7.previous.lastDay], ["2026-11-05", "2026-11-11"]);
  assert.equal(p7.previous.to, at("2026-11-11", "14:30"), "el día en curso se corta igual en el período anterior");
  const p30 = resolvePeriod("30d", NOW, TZ);
  assert.deepEqual([p30.firstDay, p30.days], ["2026-10-20", 30]);
});

test("período: mes actual contra el mismo tramo del mes anterior; mes anterior completo", () => {
  const m = resolvePeriod("mes", NOW, TZ);
  assert.deepEqual([m.firstDay, m.lastDay], ["2026-11-01", "2026-11-30"]);
  assert.equal(m.previous.from, at("2026-10-01"));
  assert.equal(m.previous.to, at("2026-10-18", "14:30"));
  const prev = resolvePeriod("mes_anterior", NOW, TZ);
  assert.deepEqual([prev.firstDay, prev.lastDay, prev.partial], ["2026-10-01", "2026-10-31", false]);
  assert.deepEqual([prev.previous.firstDay, prev.previous.lastDay], ["2026-09-01", "2026-09-30"]);
  // Enero: el anterior es diciembre del año previo.
  const jan = resolvePeriod("mes_anterior", at("2027-01-10", "10:00"), TZ);
  assert.deepEqual([jan.firstDay, jan.lastDay, jan.previous.firstDay], ["2026-12-01", "2026-12-31", "2026-11-01"]);
});

test("período personalizado: validaciones y agrupación", () => {
  const p = resolvePeriod("personalizado", NOW, TZ, { desde: "2026-01-01", hasta: "2026-06-30" });
  assert.equal(p.days, 181);
  assert.equal(p.bucket, "mes");
  assert.deepEqual([p.previous.firstDay, p.previous.lastDay], ["2025-07-04", "2025-12-31"]);
  assert.throws(() => resolvePeriod("personalizado", NOW, TZ, { desde: "2026-02-01" }), PeriodError);
  assert.throws(() => resolvePeriod("personalizado", NOW, TZ, { desde: "2026-03-01", hasta: "2026-02-01" }), PeriodError);
  assert.throws(() => resolvePeriod("personalizado", NOW, TZ, { desde: "2026-02-30", hasta: "2026-03-01" }), PeriodError);
  assert.throws(() => resolvePeriod("personalizado", NOW, TZ, { desde: "2024-01-01", hasta: "2026-01-01" }), /366/);
});

test("período con cambio de horario: los días siguen empezando a medianoche local", () => {
  const madrid = "Europe/Madrid"; // pasa a horario de invierno el 25/10/2026
  const p = resolvePeriod("personalizado", Date.UTC(2026, 10, 1), madrid, { desde: "2026-10-24", hasta: "2026-10-26" });
  assert.equal(p.to - p.from, 3 * 86_400_000 + 3_600_000, "uno de los días tiene 25 h");
});

test("grupos: no pasan del momento actual y se rotulan en castellano", () => {
  assert.deepEqual(bucketKeys(resolvePeriod("hoy", NOW, TZ), NOW, TZ).at(-1), "14");
  assert.equal(bucketKeys(resolvePeriod("ayer", NOW, TZ), NOW, TZ).length, 24);
  const month = bucketKeys(resolvePeriod("mes", NOW, TZ), NOW, TZ);
  assert.deepEqual([month.length, month[0], month.at(-1)], [18, "2026-11-01", "2026-11-18"]);
  const year = bucketKeys(resolvePeriod("personalizado", NOW, TZ, { desde: "2026-01-15", hasta: "2026-03-10" }), NOW, TZ);
  assert.equal(year.length, 55);
  const months = bucketKeys(resolvePeriod("personalizado", NOW, TZ, { desde: "2026-01-15", hasta: "2026-06-10" }), NOW, TZ);
  assert.deepEqual(months, ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]);
  assert.deepEqual([bucketLabel("09", "hora"), bucketLabel("2026-11-05", "dia"), bucketLabel("2026-11", "mes")], ["09 h", "05/11", "nov 26"]);
});

test("serie: suma por día en la zona de la empresa", () => {
  const keys = ["2026-11-17", "2026-11-18"];
  const rows = [
    { t: at("2026-11-17", "23:59"), v: 10 },
    { t: at("2026-11-18", "00:01"), v: 5 },
    { t: at("2026-11-18", "13:00"), v: 1 },
    { t: at("2026-11-19", "00:00"), v: 99 }, // fuera
  ];
  assert.deepEqual(seriesBy(rows, (r) => r.t, keys, "dia", TZ, (r) => r.v), [10, 6]);
  assert.deepEqual(seriesBy(rows, (r) => r.t, keys, "dia", TZ), [1, 2]);
  assert.equal(inRange({ from: 0, to: 10 }, 10), false);
  assert.equal(inRange({ from: 0, to: 10 }, undefined), false);
});

test("tiempo de respuesta: corrido o solo dentro del horario de atención", () => {
  const hours = { days: [1, 2, 3, 4, 5], from: "08:00", to: "18:00" };
  // Sin horario: tiempo corrido.
  assert.equal(responseMinutes(at("2026-11-18", "10:00"), at("2026-11-18", "10:12"), null, TZ), 12);
  // Mismo día hábil.
  assert.equal(responseMinutes(at("2026-11-18", "10:00"), at("2026-11-18", "10:12"), hours, TZ), 12);
  // Llega el viernes a las 21 y se responde el lunes 8:05: 5 minutos hábiles.
  assert.equal(responseMinutes(at("2026-11-20", "21:00"), at("2026-11-23", "08:05"), hours, TZ), 5);
  // Llega a las 17:50 y se responde al otro día 8:10: 10 + 10.
  assert.equal(responseMinutes(at("2026-11-18", "17:50"), at("2026-11-19", "08:10"), hours, TZ), 20);
  // Fin antes que el inicio: cero.
  assert.equal(responseMinutes(10, 5, hours, TZ), 0);
});

test("formato de duraciones y mediana", () => {
  assert.deepEqual([formatMinutes(null), formatMinutes(0.4), formatMinutes(12.4), formatMinutes(80), formatMinutes(120), formatMinutes(1500), formatMinutes(2880)], [
    "—",
    "menos de 1 min",
    "12 min",
    "1 h 20 min",
    "2 h",
    "1 d 1 h",
    "2 d",
  ]);
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
});

test("leads: paso alcanzado, atendidos, sin responder y conversión", () => {
  const base = { createdAt: at("2026-11-18", "09:00"), ownerId: "u1" };
  const leads: LeadRow[] = [
    { ...base, status: "asignado", statusAt: { recibido: 1, asignado: 1 } },
    { ...base, status: "contactado", statusAt: { recibido: 1, contactado: 1 }, firstResponseAt: at("2026-11-18", "09:10") },
    { ...base, status: "venta_realizada", statusAt: { recibido: 1, pedido_generado: 1, venta_realizada: 1 }, firstResponseAt: at("2026-11-18", "09:30") },
    // Perdido después de negociar: cuenta lo que avanzó, no es "sin responder".
    { ...base, status: "perdido", statusAt: { recibido: 1, en_negociacion: 1, perdido: 1 }, firstResponseAt: at("2026-11-18", "10:00") },
    // Perdido sin respuesta: tampoco queda pendiente.
    { ...base, status: "perdido", statusAt: { recibido: 1, perdido: 1 } },
  ];
  assert.deepEqual(leads.map(leadReach), [1, 2, 5, 3, 0]);
  const s = summarizeLeads(leads, null, TZ);
  assert.equal(s.total, 5);
  assert.equal(s.attended, 3);
  assert.equal(s.unanswered, 1);
  assert.equal(s.converted, 1);
  assert.equal(s.conversion, 0.2);
  assert.equal(s.responseAvg, (10 + 30 + 60) / 3);
  assert.equal(s.responseMedian, 30);
  assert.deepEqual(s.funnel, [5, 4, 3, 2, 1, 1]);
  assert.equal(summarizeLeads([], null, TZ).conversion, null);
});

test("ventas: monto, ticket y clientes distintos por tipo", () => {
  const sale = (customerId: string, total: number, customerKind?: "nuevo" | "recurrente" | "reactivado") => ({ sellerId: "u1", customerId, total, customerKind, confirmedAt: 0 });
  const s = summarizeSales([
    sale("a", 1000.1, "nuevo"),
    sale("a", 500.2, "recurrente"), // repitió en el mismo período: sigue siendo cliente nuevo
    sale("b", 300, "recurrente"),
    sale("c", 200, "reactivado"),
    sale("d", 100), // pedido anterior al campo: recurrente
  ]);
  assert.equal(s.count, 5);
  assert.equal(s.revenue, 2100.3);
  assert.equal(s.avgTicket, 420.06);
  assert.deepEqual(s.buyers, { nuevo: 1, recurrente: 2, reactivado: 1 });
  assert.equal(summarizeSales([]).avgTicket, null);
});

test("eje: marcas redondas y enteras", () => {
  assert.deepEqual(niceTicks(5), [0, 2, 4, 6]);
  assert.deepEqual(niceTicks(3), [0, 1, 2, 3]);
  assert.deepEqual(niceTicks(0), [0, 1]);
  assert.deepEqual(niceTicks(9500), [0, 2500, 5000, 7500, 10000]);
  assert.deepEqual(niceTicks(1_234_000), [0, 500_000, 1_000_000, 1_500_000]);
});
