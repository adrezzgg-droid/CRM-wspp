import { test } from "node:test";
import assert from "node:assert/strict";
import { INBOX_FILTERS, inboxQuery } from "./inbox-filters.ts";

test("el vendedor siempre consulta lo suyo (requisito de las reglas)", () => {
  for (const f of INBOX_FILTERS) {
    const q = inboxQuery(f.id, { uid: "v1", scope: "propio" });
    if (q === null) continue;
    assert.deepEqual(q.clauses[0], ["assigneeId", "==", "v1"], f.id);
    assert.equal(q.teamOnly, false);
  }
});

test("el vendedor no tiene 'sin asignar'", () => {
  assert.equal(inboxQuery("sin_asignar", { uid: "v1", scope: "propio" }), null);
  assert.deepEqual(inboxQuery("sin_asignar", { uid: "a", scope: "todo" })?.clauses[0], ["assigneeId", "==", null]);
});

test("sin permiso de bandeja no hay consulta", () => {
  assert.equal(inboxQuery("todos", { uid: "r", scope: null }), null);
});

test("el supervisor filtra por equipo en el navegador, salvo en 'mis conversaciones'", () => {
  assert.equal(inboxQuery("todos", { uid: "s", scope: "equipo" })?.teamOnly, true);
  assert.equal(inboxQuery("mias", { uid: "s", scope: "equipo" })?.teamOnly, false);
});

test("cerrados no incluye abiertas y 'todos' no incluye cerradas", () => {
  assert.deepEqual(inboxQuery("cerrados", { uid: "a", scope: "todo" })?.clauses, [["status", "==", "cerrada"]]);
  assert.deepEqual(inboxQuery("todos", { uid: "a", scope: "todo" })?.clauses, [["status", "in", ["nueva", "pendiente", "en_atencion"]]]);
});

test("nuevos leads y clientes se distinguen por la etapa del cliente", () => {
  assert.deepEqual(inboxQuery("nuevos_leads", { uid: "a", scope: "todo" })?.clauses[0], ["customerStage", "==", "prospecto"]);
  const c = inboxQuery("clientes", { uid: "a", scope: "todo" })?.clauses[0];
  assert.equal(c?.[1], "in");
  assert.ok(!(c?.[2] as string[]).includes("prospecto"));
});
