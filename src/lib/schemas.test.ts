import { test } from "node:test";
import assert from "node:assert/strict";
import { customerInput, customerUpdate, generalSettingsInput, memberCreate, permissionsInput } from "./schemas.ts";

test("cliente: campos vacíos quedan ausentes y se aplican defaults", () => {
  const r = customerInput.parse({ name: "  Juan  ", company: "", email: "", zoneId: "" });
  assert.equal(r.name, "Juan");
  assert.equal(r.company, undefined);
  assert.equal(r.email, undefined);
  assert.equal(r.zoneId, undefined);
  assert.equal(r.stage, "prospecto");
  assert.deepEqual(r.tagIds, []);
});

test("cliente: valida nombre, email y etapa", () => {
  assert.equal(customerInput.safeParse({ name: "J" }).success, false);
  assert.equal(customerInput.safeParse({ name: "Juan", email: "no-es-email" }).success, false);
  assert.equal(customerInput.safeParse({ name: "Juan", stage: "inventada" }).success, false);
  assert.equal(customerInput.parse({ name: "Juan", email: "A@B.COM" }).email, "a@b.com");
});

test("usuario: rol válido y email normalizado", () => {
  assert.equal(memberCreate.safeParse({ email: "x@y.com", displayName: "X Y", role: "root" }).success, false);
  assert.equal(memberCreate.parse({ email: " X@Y.com ", displayName: "X Y", role: "vendedor" }).email, "x@y.com");
});

test("permisos: el admin no se puede sobrescribir", () => {
  assert.equal(permissionsInput.safeParse({ overrides: { admin: {} } }).success, false);
  assert.equal(
    permissionsInput.safeParse({
      overrides: { vendedor: { clientes: { actions: ["ver", "crear"], scope: "propio" } } },
    }).success,
    true,
  );
  assert.equal(
    permissionsInput.safeParse({ overrides: { vendedor: { clientes: { actions: ["borrar"], scope: "propio" } } } })
      .success,
    false,
  );
});

test("horario de atención coherente", () => {
  const base = { defaultCountryCode: "54" };
  assert.equal(generalSettingsInput.safeParse({ ...base, businessHours: null }).success, true);
  assert.equal(
    generalSettingsInput.safeParse({ ...base, businessHours: { days: [1, 2], from: "18:00", to: "09:00" } }).success,
    false,
  );
  assert.equal(
    generalSettingsInput.safeParse({ ...base, businessHours: { days: [1], from: "09:00", to: "18:00" } }).success,
    true,
  );
});

test("edición parcial de cliente: no aplica defaults y distingue vacío de ausente", () => {
  const r = customerUpdate.parse({ company: "" });
  assert.deepEqual(Object.keys(r), ["company"]);
  assert.equal(r.company, undefined);
  assert.ok(!("stage" in r));
});
