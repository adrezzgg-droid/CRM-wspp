import { test } from "node:test";
import assert from "node:assert/strict";
import { accessScopeFor } from "./scope-core.ts";

const teams = [
  { leaderIds: ["sup"], memberIds: ["v1", "v2"] },
  { leaderIds: ["otro"], memberIds: ["v3"] },
];

test("alcance de la bandeja para las reglas: por rol, equipos y permisos de la empresa", () => {
  assert.deepEqual(accessScopeFor({ id: "adm", role: "admin" }, teams, {}), { inboxScope: "todo", scopeUids: [] });
  assert.deepEqual(accessScopeFor({ id: "sup", role: "supervisor" }, teams, {}), { inboxScope: "equipo", scopeUids: ["sup", "v1", "v2"] });
  assert.deepEqual(accessScopeFor({ id: "v1", role: "vendedor" }, teams, {}), { inboxScope: "propio", scopeUids: [] });
  assert.deepEqual(accessScopeFor({ id: "r", role: "repartidor" }, teams, {}), { inboxScope: "", scopeUids: [] }, "sin bandeja");
  // La empresa le da al supervisor la bandeja completa: las reglas lo respetan.
  const overrides = { supervisor: { inbox: { actions: ["ver"] as const, scope: "todo" as const } } };
  assert.deepEqual(accessScopeFor({ id: "sup", role: "supervisor" }, teams, overrides), { inboxScope: "todo", scopeUids: [] });
});
