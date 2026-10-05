import { test } from "node:test";
import assert from "node:assert/strict";
import { formatWhatsappId, toWhatsappId } from "./phone.ts";

const CBA = "5493515551234";

test("formato internacional argentino, con y sin el 9", () => {
  assert.equal(toWhatsappId("+54 9 351 555-1234"), CBA);
  assert.equal(toWhatsappId("+54 351 555 1234"), CBA);
  assert.equal(toWhatsappId("0054 9 351 5551234"), CBA);
});

test("formato local argentino: 0, 15 y códigos de área de 2, 3 y 4 dígitos", () => {
  assert.equal(toWhatsappId("0351 15 555-1234"), CBA);
  assert.equal(toWhatsappId("351 555 1234"), CBA);
  assert.equal(toWhatsappId("(011) 15 4444-5555"), "5491144445555");
  assert.equal(toWhatsappId("11 4444 5555"), "5491144445555");
  assert.equal(toWhatsappId("03543 15 44-5566"), "5493543445566");
  assert.equal(toWhatsappId("5493515551234"), CBA);
  assert.equal(toWhatsappId("543515551234"), CBA);
});

test("números incompletos o vacíos no se aceptan", () => {
  assert.equal(toWhatsappId(""), null);
  assert.equal(toWhatsappId("555-1234"), null);
  assert.equal(toWhatsappId("+54 351 555"), null);
});

test("otros países", () => {
  assert.equal(toWhatsappId("+598 99 123 456"), "59899123456");
  assert.equal(toWhatsappId("099 123 456", "598"), "59899123456");
  assert.equal(toWhatsappId("+1 (415) 555-0100"), "14155550100");
});

test("formato para mostrar", () => {
  assert.equal(formatWhatsappId(CBA), "+54 9 351 555-1234");
  assert.equal(formatWhatsappId("59899123456"), "+59899123456");
});
