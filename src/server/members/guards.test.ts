import { test } from "node:test";
import assert from "node:assert/strict";
import { checkCreate, checkEdit, checkRoleChange, checkStatusChange } from "./guards.ts";

const admin = { uid: "a1", role: "admin" as const };
const sup = { uid: "s1", role: "supervisor" as const };
const adminTarget = { id: "a2", role: "admin" as const, active: true };
const seller = { id: "v1", role: "vendedor" as const, active: true };

test("solo un admin crea admins", () => {
  assert.equal(checkCreate(admin, "admin"), null);
  assert.ok(checkCreate(sup, "admin"));
  assert.equal(checkCreate(sup, "vendedor"), null);
});

test("nadie cambia su propio rol", () => {
  assert.ok(checkRoleChange(admin, { id: "a1", role: "admin", active: true }, "vendedor", 3));
});

test("no se puede dejar a la organización sin administrador", () => {
  assert.ok(checkRoleChange(admin, adminTarget, "supervisor", 1));
  assert.equal(checkRoleChange(admin, adminTarget, "supervisor", 2), null);
  assert.ok(checkStatusChange(admin, adminTarget, false, 1));
  assert.equal(checkStatusChange(admin, adminTarget, false, 2), null);
});

test("un no-admin con permiso de usuarios no puede escalar ni tocar admins", () => {
  assert.ok(checkRoleChange(sup, seller, "admin", 2));
  assert.ok(checkRoleChange(sup, adminTarget, "vendedor", 2));
  assert.ok(checkEdit(sup, adminTarget));
  assert.ok(checkStatusChange(sup, adminTarget, false, 3));
  assert.equal(checkRoleChange(sup, seller, "supervisor", 1), null);
});

test("nadie se da de baja a sí mismo; sin cambios no hay rechazo", () => {
  assert.ok(checkStatusChange(admin, { id: "a1", role: "admin", active: true }, false, 5));
  assert.equal(checkStatusChange(admin, seller, true, 1), null);
});
