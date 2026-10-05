import { test } from "node:test";
import assert from "node:assert/strict";
import {
  can,
  scopeOf,
  visibleResources,
  resolvePolicy,
  isRole,
  RESOURCES,
  ACTIONS,
} from "./matrix.ts";

test("admin puede todo sobre todos los recursos", () => {
  for (const r of RESOURCES) {
    for (const a of ACTIONS) assert.equal(can("admin", r, a), true, `${r}:${a}`);
  }
});

test("vendedor no accede a configuración, usuarios ni WhatsApp", () => {
  for (const r of ["usuarios", "whatsapp_config", "configuracion", "automatizaciones", "auditoria"] as const) {
    assert.equal(can("vendedor", r, "ver"), false, r);
  }
});

test("vendedor ve solo lo propio en inbox y clientes", () => {
  assert.equal(scopeOf("vendedor", "inbox"), "propio");
  assert.equal(scopeOf("vendedor", "clientes"), "propio");
  assert.equal(can("vendedor", "inbox", "asignar"), false);
});

test("supervisor puede asignar conversaciones pero no configurar WhatsApp", () => {
  assert.equal(can("supervisor", "inbox", "asignar"), true);
  assert.equal(can("supervisor", "whatsapp_config", "ver"), false);
  assert.equal(scopeOf("supervisor", "dashboard"), "equipo");
});

test("solo lectura nunca crea, edita ni elimina", () => {
  for (const r of RESOURCES) {
    for (const a of ["crear", "editar", "eliminar", "asignar"] as const) {
      assert.equal(can("solo_lectura", r, a), false, `${r}:${a}`);
    }
  }
});

test("repartidor solo ve su día, pedidos y tareas", () => {
  assert.deepEqual(
    visibleResources("repartidor").sort(),
    ["mi_dia", "pedidos", "tareas"].sort(),
  );
});

test("los overrides de la organización se aplican a roles no admin", () => {
  assert.equal(can("vendedor", "dashboard", "ver"), false);
  assert.equal(
    can("vendedor", "dashboard", "ver", {
      vendedor: { dashboard: { actions: ["ver"], scope: "propio" } },
    }),
    true,
  );
});

test("los overrides no pueden degradar al administrador", () => {
  const policy = resolvePolicy("admin", {
    admin: { usuarios: { actions: [], scope: "propio" } },
  });
  assert.equal(policy.usuarios?.scope, "todo");
  assert.equal(can("admin", "usuarios", "eliminar", { admin: {} }), true);
});

test("isRole valida entradas desconocidas", () => {
  assert.equal(isRole("admin"), true);
  assert.equal(isRole("root"), false);
  assert.equal(isRole(undefined), false);
});

test("el supervisor reasigna clientes de su equipo; el vendedor no", () => {
  assert.equal(can("supervisor", "clientes", "asignar"), true);
  assert.equal(scopeOf("supervisor", "clientes"), "equipo");
  assert.equal(can("vendedor", "clientes", "asignar"), false);
  assert.equal(can("vendedor", "clientes", "eliminar"), false);
});
