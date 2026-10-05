import { test } from "node:test";
import assert from "node:assert/strict";
import { extractVariables, renderTemplate, suggestMetaName, toMetaBody, unknownVariables } from "./templates.ts";
import { conditionsMatch, describeTrigger, runId, subjectKey } from "./automations.ts";

const body = "Hola {{nombre}}! Tu pedido {{pedido}} por {{importe}} sale hoy. Gracias {{ nombre }}.";

test("variables en orden, sin repetir, tolerando espacios", () => {
  assert.deepEqual(extractVariables(body), ["nombre", "pedido", "importe"]);
  assert.deepEqual(unknownVariables("Hola {{nombre}} {{apodo}}"), ["apodo"]);
});

test("vista previa con valores", () => {
  assert.equal(renderTemplate("Hola {{nombre}}, {{x}}", { nombre: "Ana" }), "Hola Ana, ");
});

test("formato posicional de Meta: la misma variable usa el mismo número", () => {
  assert.deepEqual(toMetaBody(body), { text: "Hola {{1}}! Tu pedido {{2}} por {{3}} sale hoy. Gracias {{1}}.", order: ["nombre", "pedido", "importe"] });
});

test("nombre válido para Meta", () => {
  assert.equal(suggestMetaName("Confirmación de pedido!"), "confirmacion_de_pedido");
});

test("condiciones de las reglas", () => {
  assert.equal(conditionsMatch({}, { stage: "prospecto" }), true);
  assert.equal(conditionsMatch({ stages: ["cliente_activo"] }, { stage: "prospecto" }), false);
  assert.equal(conditionsMatch({ zoneIds: ["norte"] }, { stage: "prospecto", zoneId: "norte" }), true);
  assert.equal(conditionsMatch({ zoneIds: ["norte"] }, { stage: "prospecto" }), false);
});

test("descripción y claves de idempotencia", () => {
  assert.equal(describeTrigger({ trigger: "sin_respuesta_cliente", triggerParams: { hours: 24 }, delayMinutes: 0 }), "El cliente no responde en 24 h");
  assert.equal(describeTrigger({ trigger: "pedido_creado", triggerParams: {}, delayMinutes: 120 }), "Se confirma un pedido · espera 2 h");
  assert.equal(subjectKey("sin_compra_dias", { customerId: "c1", since: 5 }), "compra:c1:5");
  assert.equal(runId("r1", "conv:a/b c"), "r1__conv:a_b_c");
});
