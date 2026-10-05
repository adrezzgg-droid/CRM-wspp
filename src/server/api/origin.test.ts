import { test } from "node:test";
import assert from "node:assert/strict";
import { isSameOrigin, SAFE_METHODS } from "./origin.ts";

test("acepta el mismo host", () => {
  assert.equal(isSameOrigin("http://localhost:3000", "localhost:3000"), true);
  assert.equal(isSameOrigin("https://crm.ejemplo.com", "crm.ejemplo.com"), true);
});

test("acepta APP_URL detrás de un proxy que cambia el host", () => {
  assert.equal(
    isSameOrigin("https://crm.ejemplo.com", "interno:8080", "https://crm.ejemplo.com"),
    true,
  );
});

test("rechaza otros orígenes, origen ausente o inválido", () => {
  assert.equal(isSameOrigin("https://malicioso.com", "crm.ejemplo.com"), false);
  assert.equal(isSameOrigin("https://crm.ejemplo.com.malicioso.com", "crm.ejemplo.com"), false);
  assert.equal(isSameOrigin(null, "crm.ejemplo.com"), false);
  assert.equal(isSameOrigin("null", "crm.ejemplo.com"), false);
  assert.equal(isSameOrigin("http://localhost:3001", "localhost:3000"), false);
});

test("solo GET/HEAD/OPTIONS se consideran seguros", () => {
  for (const m of ["GET", "HEAD", "OPTIONS"]) assert.equal(SAFE_METHODS.has(m), true);
  for (const m of ["POST", "PUT", "PATCH", "DELETE"]) assert.equal(SAFE_METHODS.has(m), false);
});
