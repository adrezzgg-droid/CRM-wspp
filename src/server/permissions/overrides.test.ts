import { test } from "node:test";
import assert from "node:assert/strict";
import { can, resolvePolicy } from "./matrix.ts";
import { fullPolicy, overridesFor } from "./overrides.ts";

test("sin cambios no se guarda ningún override", () => {
  assert.deepEqual(overridesFor("vendedor", fullPolicy("vendedor")), {});
  assert.deepEqual(overridesFor("supervisor", fullPolicy("supervisor")), {});
});

test("quitar 'editar' de clientes al vendedor (política de Impulse360)", () => {
  const p = fullPolicy("vendedor");
  p.clientes = { actions: ["ver", "crear"], scope: "propio" };
  const o = overridesFor("vendedor", p);
  assert.deepEqual(Object.keys(o), ["clientes"]);
  assert.equal(can("vendedor", "clientes", "editar", { vendedor: o }), false);
  assert.equal(can("vendedor", "clientes", "crear", { vendedor: o }), true);
});

test("quitar un recurso entero guarda acciones vacías", () => {
  const p = fullPolicy("vendedor");
  p.productos = { actions: [], scope: "todo" };
  const o = overridesFor("vendedor", p);
  assert.deepEqual(o.productos?.actions, []);
  assert.equal(can("vendedor", "productos", "ver", { vendedor: o }), false);
});

test("dar un recurso nuevo y volver al default", () => {
  const p = fullPolicy("vendedor");
  p.dashboard = { actions: ["ver"], scope: "propio" };
  const o = overridesFor("vendedor", p);
  assert.equal(can("vendedor", "dashboard", "ver", { vendedor: o }), true);
  const back = fullPolicy("vendedor", { vendedor: o });
  back.dashboard = { actions: [], scope: "propio" };
  assert.deepEqual(overridesFor("vendedor", back), {});
});

test("fullPolicy respeta overrides y nunca degrada al admin", () => {
  assert.deepEqual(fullPolicy("admin", { vendedor: {} }).usuarios.actions, ["ver", "crear", "editar", "eliminar", "asignar"]);
  assert.deepEqual(resolvePolicy("vendedor").clientes?.scope, fullPolicy("vendedor").clientes.scope);
});
