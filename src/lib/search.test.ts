import { test } from "node:test";
import assert from "node:assert/strict";
import { customerKeywords, matchesAll, queryTerms } from "./search.ts";

const kw = customerKeywords({
  name: "Pollería Don José",
  company: "Distribuidora Sur S.A.",
  whatsappId: "5493515551234",
  email: "compras@donjose.com",
  neighborhood: "Barrio Güemes",
});

const finds = (q: string) => matchesAll(kw, queryTerms(q));

test("encuentra por nombre y empresa sin importar acentos ni mayúsculas", () => {
  assert.ok(finds("polleria"));
  assert.ok(finds("JOSÉ"));
  assert.ok(finds("don jo"));
  assert.ok(finds("distrib sur"));
  assert.ok(finds("guemes"));
});

test("encuentra por teléfono: número nacional, internacional o últimos 4", () => {
  assert.ok(finds("3515551234"));
  assert.ok(finds("351555"));
  assert.ok(finds("549351"));
  assert.ok(finds("1234"));
  assert.ok(finds("351.555"));
  // Número local, sin código de área
  assert.ok(finds("5551234"));
  assert.ok(finds("555-12"));
});

test("encuentra por email", () => {
  assert.ok(finds("compras"));
});

test("no encuentra lo que no está", () => {
  assert.ok(!finds("carniceria"));
  assert.ok(!finds("polleria norte"));
  assert.ok(!finds("9999"));
});

test("queryTerms ordena del más largo al más corto y descarta términos de 1 letra", () => {
  assert.deepEqual(queryTerms("a don josé"), ["jose", "don"]);
  assert.deepEqual(queryTerms("  "), []);
});

test("no hay palabras clave repetidas", () => {
  assert.equal(new Set(kw).size, kw.length);
});
