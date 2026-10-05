/**
 * Reglas de pedidos: totales, numeración, transiciones de estado y
 * estadísticas del cliente. Código puro.
 */
import type { Customer, LeadStatus, OrderItem, OrderStatus } from "../types/model.ts";

/** Redondeo a centavos (evita 0.1 + 0.2). */
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function orderTotal(items: Pick<OrderItem, "qty" | "unitPrice">[]): number {
  return round2(items.reduce((sum, i) => sum + round2(i.qty * i.unitPrice), 0));
}

export function formatOrderNumber(n: number): string {
  return `P-${String(n).padStart(6, "0")}`;
}

/** Quién mueve el pedido: vendedor (o supervisor), repartidor o administración. */
export type OrderActor = "vendedor" | "repartidor" | "admin";

const TRANSITIONS: Record<OrderActor, Partial<Record<OrderStatus, OrderStatus[]>>> = {
  vendedor: {
    borrador: ["confirmado", "cancelado"],
    confirmado: ["cancelado"],
  },
  repartidor: {
    en_preparacion: ["en_reparto"],
    en_reparto: ["entregado"],
  },
  admin: {
    borrador: ["confirmado", "cancelado"],
    confirmado: ["en_preparacion", "en_reparto", "cancelado"],
    en_preparacion: ["en_reparto", "confirmado", "cancelado"],
    en_reparto: ["entregado", "en_preparacion", "cancelado"],
    entregado: [],
    cancelado: [],
  },
};

export function canTransition(actor: OrderActor, from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[actor][from]?.includes(to) ?? false;
}

export function nextStatuses(actor: OrderActor, from: OrderStatus): OrderStatus[] {
  return TRANSITIONS[actor][from] ?? [];
}

/** Un pedido "cuenta" como compra desde que se confirma hasta que se cancela. */
export const COUNTED_STATUSES: OrderStatus[] = ["confirmado", "en_preparacion", "en_reparto", "entregado"];

/** Estadísticas del cliente al sumar (+1) o descontar (-1) un pedido. */
export function applyOrderToStats(stats: Customer["stats"], total: number, direction: 1 | -1): Customer["stats"] {
  const ordersCount = Math.max(0, stats.ordersCount + direction);
  const totalPurchased = Math.max(0, round2(stats.totalPurchased + direction * total));
  return { ordersCount, totalPurchased, avgTicket: ordersCount ? round2(totalPurchased / ordersCount) : 0 };
}

/** Estado del lead que corresponde a un evento del pedido. */
export function leadStatusForOrder(status: OrderStatus): LeadStatus | null {
  if (status === "confirmado") return "pedido_generado";
  if (status === "entregado") return "venta_realizada";
  return null;
}
