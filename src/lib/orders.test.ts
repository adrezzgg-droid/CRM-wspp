import { test } from "node:test";
import assert from "node:assert/strict";
import { applyOrderToStats, canTransition, formatOrderNumber, leadStatusForOrder, nextStatuses, orderTotal } from "./orders.ts";
import { columnSummary, daysInStage, leadStatusForStage } from "./pipeline.ts";

test("total con decimales sin errores de coma flotante", () => {
  assert.equal(orderTotal([{ qty: 0.1, unitPrice: 0.2 }, { qty: 0.2, unitPrice: 0.1 }]), 0.04);
  assert.equal(orderTotal([{ qty: 2.5, unitPrice: 4590 }, { qty: 10, unitPrice: 3200.5 }]), 43480);
  assert.equal(orderTotal([]), 0);
});

test("numeración correlativa legible", () => {
  assert.equal(formatOrderNumber(1), "P-000001");
  assert.equal(formatOrderNumber(1234567), "P-1234567");
});

test("transiciones según quién mueve el pedido", () => {
  assert.equal(canTransition("vendedor", "borrador", "confirmado"), true);
  assert.equal(canTransition("vendedor", "confirmado", "entregado"), false);
  assert.equal(canTransition("repartidor", "en_reparto", "entregado"), true);
  assert.equal(canTransition("repartidor", "confirmado", "cancelado"), false);
  assert.equal(canTransition("admin", "entregado", "cancelado"), false, "un entregado no se cancela");
  assert.deepEqual(nextStatuses("admin", "cancelado"), []);
});

test("estadísticas: confirmar suma, cancelar descuenta", () => {
  const s0 = { ordersCount: 0, totalPurchased: 0, avgTicket: 0 };
  const s1 = applyOrderToStats(s0, 1000, 1);
  const s2 = applyOrderToStats(s1, 500.5, 1);
  assert.deepEqual(s2, { ordersCount: 2, totalPurchased: 1500.5, avgTicket: 750.25 });
  assert.deepEqual(applyOrderToStats(s2, 500.5, -1), { ordersCount: 1, totalPurchased: 1000, avgTicket: 1000 });
  assert.deepEqual(applyOrderToStats(s0, 100, -1), s0, "nunca negativo");
});

test("pedido y pipeline mueven el recorrido del lead", () => {
  assert.equal(leadStatusForOrder("confirmado"), "pedido_generado");
  assert.equal(leadStatusForOrder("entregado"), "venta_realizada");
  assert.equal(leadStatusForOrder("en_reparto"), null);
  assert.equal(leadStatusForStage({ id: "cotizacion", kind: "abierta" }), "en_negociacion");
  assert.equal(leadStatusForStage({ id: "cualquiera", kind: "perdida" }), "perdido");
  assert.equal(leadStatusForStage({ id: "nuevo_lead", kind: "abierta" }), null);
});

test("resumen de columna y antigüedad", () => {
  assert.deepEqual(columnSummary([{ estimatedValue: 1000, probability: 50 }, { estimatedValue: 300, probability: 10 }]), { count: 2, total: 1300, weighted: 530 });
  assert.equal(daysInStage(0, 3 * 86_400_000 + 5), 3);
});
