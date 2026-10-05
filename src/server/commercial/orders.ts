import "server-only";
import { FieldValue, type Query, type Transaction } from "firebase-admin/firestore";
import type { z } from "zod";
import type { Customer, Member, Notification, Opportunity, Order, OrderItem, OrderStatus, OutboxItem } from "@/types/model";
import { ORDER_STATUS_LABELS } from "@/types/model";
import { adminDb } from "@/server/firebase/admin";
import { ApiError } from "@/server/api/handler";
import { recordActivityIn, type ActivityEntry } from "@/server/audit";
import { can, type Action } from "@/server/permissions/matrix";
import { scopeAllows } from "@/server/permissions/scope";
import type { Session } from "@/server/auth/session";
import { getMembers, scopeContext } from "@/server/org/data";
import { getAccessibleCustomer } from "@/server/customers/service";
import { applyOrderToStats, canTransition, COUNTED_STATUSES, formatOrderNumber, leadStatusForOrder, orderTotal, round2, type OrderActor } from "@/lib/orders";
import type { OrderListQuery, orderInput, orderStatusInput } from "@/lib/schemas";
import { col, getPipeline, readCommercialEffects } from "./common";
import { getProducts } from "./products";

export const ORDERS_PAGE_SIZE = 50;

function requireOrders(session: Session, action: Action) {
  if (!can(session.role, "pedidos", action, session.overrides)) throw new ApiError(403, "No tenés permiso para esta acción sobre pedidos");
}

/** Supervisores y administradores gestionan todo el circuito; vendedor y repartidor, su parte. */
export function orderActor(session: Session): OrderActor {
  if (session.role === "repartidor") return "repartidor";
  if (session.role === "admin" || session.role === "supervisor") return "admin";
  return "vendedor";
}

function activity(session: Session, o: Pick<Order, "id" | "customerId" | "leadId" | "conversationId">, kind: string, summary: string, data?: Record<string, unknown>): ActivityEntry {
  return { orgId: session.orgId, isDemo: session.org.isDemo, customerId: o.customerId, leadId: o.leadId, conversationId: o.conversationId, orderId: o.id, kind, summary, actorId: session.uid, data };
}

/** Alcance: el vendedor ve lo que vendió; el repartidor, lo que tiene que entregar. */
async function canSeeOrder(session: Session, o: Pick<Order, "sellerId" | "driverId">): Promise<boolean> {
  if (o.driverId && o.driverId === session.uid) return true;
  if (session.role === "repartidor") return false;
  return scopeAllows(await scopeContext(session, "pedidos"), o.sellerId);
}

export async function loadOrder(session: Session, id: string, action: Action = "ver"): Promise<Order> {
  requireOrders(session, action);
  const snap = await col(session.orgId, "orders").doc(id).get();
  if (!snap.exists) throw new ApiError(404, "Pedido no encontrado");
  const order = { ...(snap.data() as Order), id: snap.id };
  if (!(await canSeeOrder(session, order))) throw new ApiError(404, "Pedido no encontrado");
  return order;
}

export async function listOrders(session: Session, f: OrderListQuery): Promise<{ items: Order[]; nextCursor: string | null }> {
  requireOrders(session, "ver");
  const ctx = await scopeContext(session, "pedidos");
  let q: Query = col(session.orgId, "orders");
  let memory: (o: Order) => boolean = () => true;
  if (session.role === "repartidor") {
    q = q.where("driverId", "==", session.uid);
  } else if (f.vendedor) {
    if (!scopeAllows(ctx, f.vendedor)) return { items: [], nextCursor: null };
    q = q.where("sellerId", "==", f.vendedor);
  } else if (ctx.scope === "propio") {
    q = q.where("sellerId", "==", session.uid);
  } else if (ctx.scope === "equipo") {
    if (ctx.teamUids.length <= 30) q = q.where("sellerId", "in", [...ctx.teamUids]);
    else memory = (o) => scopeAllows(ctx, o.sellerId);
  }
  if (f.repartidor && session.role !== "repartidor") q = q.where("driverId", "==", f.repartidor);
  if (f.status) q = q.where("status", "==", f.status);
  q = q.orderBy("createdAt", "desc");
  if (f.cursor) {
    const c = await col(session.orgId, "orders").doc(f.cursor).get();
    if (c.exists) q = q.startAfter(c);
  }
  const snap = await q.limit(ORDERS_PAGE_SIZE).get();
  const items = snap.docs.map((d) => ({ ...(d.data() as Order), id: d.id })).filter(memory);
  return { items, nextCursor: snap.size === ORDERS_PAGE_SIZE ? snap.docs.at(-1)!.id : null };
}

// ───────────────────────────── Efectos ──────────────────────────────────────

/** ¿Hay conectores activos que esperan este evento? (se configuran en la Fase 9) */
async function readOutboxConnectors(tx: Transaction, orgId: string): Promise<string[]> {
  const snap = await tx.get(col(orgId, "settings").doc("integrations"));
  const connectors = (snap.data()?.connectors ?? {}) as Record<string, { enabled?: boolean; events?: string[] }>;
  return Object.entries(connectors)
    .filter(([, c]) => c.enabled && (!c.events || c.events.includes("order.confirmed")))
    .map(([name]) => name);
}

function enqueueIn(tx: Transaction, session: Session, connectors: string[], event: string, order: Order, now: number) {
  for (const connector of connectors) {
    const ref = col(session.orgId, "outbox").doc();
    const item: OutboxItem = {
      id: ref.id,
      orgId: session.orgId,
      isDemo: session.org.isDemo,
      connector,
      event,
      payload: {
        orderId: order.id,
        number: order.number,
        customerId: order.customerId,
        customerName: order.customerName,
        items: order.items,
        total: order.total,
        currency: order.currency,
        deliveryAddress: order.deliveryAddress ?? null,
        deliveryDate: order.deliveryDate ?? null,
      },
      status: "pendiente",
      attempts: 0,
      nextAttemptAt: now,
      createdAt: now,
    };
    tx.create(ref, item);
  }
}

/** Movimiento de la oportunidad vinculada cuando avanza el pedido (solo hacia adelante). */
async function readOpportunityEffect(tx: Transaction, session: Session, opportunityId: string | undefined, status: OrderStatus) {
  if (!opportunityId) return null;
  const ref = col(session.orgId, "opportunities").doc(opportunityId);
  const opp = (await tx.get(ref)).data() as Opportunity | undefined;
  const targetId = status === "confirmado" ? "pedido" : status === "entregado" ? "venta" : null;
  if (!opp || !targetId) return null;
  const stages = (await getPipeline(session.orgId)).stages;
  const current = stages.find((s) => s.id === opp.stageId);
  const target = stages.find((s) => s.id === targetId);
  // Solo avanza oportunidades abiertas que estén antes de la etapa destino.
  if (!current || !target || current.kind !== "abierta" || current.order >= target.order) return null;
  return (now: number) => {
    tx.update(ref, {
      stageId: target.id,
      probability: target.probability,
      stageChangedAt: now,
      ...(target.kind === "ganada" ? { closedAt: now } : {}),
      updatedAt: now,
      updatedBy: session.uid,
    });
  };
}

// ───────────────────────────── Alta ─────────────────────────────────────────

export async function createOrder(session: Session, input: z.output<typeof orderInput>): Promise<Order> {
  requireOrders(session, "crear");
  if (session.role === "repartidor") throw new ApiError(403, "El repartidor no crea pedidos");
  const customer = await getAccessibleCustomer(session, input.customerId);
  if (customer.archived) throw new ApiError(409, "El cliente está dado de baja");

  const catalog = new Map((await getProducts(session.orgId)).map((p) => [p.id, p]));
  const items: OrderItem[] = input.items.map((i, idx) => {
    const p = catalog.get(i.productId);
    if (!p || !p.active) throw new ApiError(422, "Hay productos inexistentes o desactivados", [{ path: ["items", idx], message: "Producto inválido" }]);
    return { productId: p.id, name: p.name, qty: i.qty, unitPrice: round2(i.unitPrice ?? p.price) };
  });
  const total = orderTotal(items);
  const status: OrderStatus = input.confirm ? "confirmado" : "borrador";
  const sellerId = session.role === "vendedor" ? session.uid : (customer.ownerId ?? session.uid);
  const ref = col(session.orgId, "orders").doc();
  const counterRef = col(session.orgId, "settings").doc("counters");
  const now = Date.now();
  let created!: Order;

  await adminDb().runTransaction(async (tx) => {
    // Lecturas
    const counter = ((await tx.get(counterRef)).data()?.orders as number | undefined) ?? 0;
    const effects = await readCommercialEffects(tx, session, { leadId: input.leadId, customerId: customer.id, convertProspect: input.confirm });
    const oppEffect = input.confirm ? await readOpportunityEffect(tx, session, input.opportunityId, "confirmado") : null;
    const connectors = input.confirm ? await readOutboxConnectors(tx, session.orgId) : [];
    const freshCustomer = effects.customer as Customer;

    // Escrituras
    created = {
      id: ref.id,
      orgId: session.orgId,
      isDemo: session.org.isDemo,
      number: formatOrderNumber(counter + 1),
      customerId: customer.id,
      customerName: customer.name,
      sellerId,
      conversationId: input.conversationId,
      leadId: input.leadId,
      opportunityId: input.opportunityId,
      items,
      total,
      currency: session.org.currency,
      status,
      statusAt: { borrador: now, ...(input.confirm ? { confirmado: now } : {}) },
      deliveryAddress: input.deliveryAddress ?? customer.address,
      deliveryDate: input.deliveryDate,
      notes: input.notes,
      counted: input.confirm,
      createdAt: now,
      createdBy: session.uid,
      updatedAt: now,
      updatedBy: session.uid,
    };
    tx.set(counterRef, { orders: counter + 1 }, { merge: true });
    tx.create(ref, created);
    recordActivityIn(tx, activity(session, created, input.confirm ? "pedido.confirmado" : "pedido.creado", `Pedido ${created.number} ${input.confirm ? "confirmado" : "en borrador"} por ${new Intl.NumberFormat("es-AR", { style: "currency", currency: session.org.currency }).format(total)}`), now);
    if (input.confirm) {
      tx.update(effects.customerRef, { stats: applyOrderToStats(freshCustomer.stats, total, 1), lastPurchaseAt: now });
      effects.write({ to: "pedido_generado" }, now, { orderId: ref.id });
      oppEffect?.(now);
      enqueueIn(tx, session, connectors, "order.confirmed", created, now);
    }
  });
  return created;
}

// ───────────────────────────── Estado ───────────────────────────────────────

export async function changeOrderStatus(session: Session, id: string, input: z.output<typeof orderStatusInput>): Promise<Order> {
  const order = await loadOrder(session, id, "editar");
  const actor = orderActor(session);
  if (actor === "repartidor" && order.driverId !== session.uid) throw new ApiError(403, "El pedido no está asignado a vos");
  if (order.status === input.status) return order;
  if (!canTransition(actor, order.status, input.status)) {
    throw new ApiError(409, `No se puede pasar de "${ORDER_STATUS_LABELS[order.status]}" a "${ORDER_STATUS_LABELS[input.status]}"`);
  }
  const now = Date.now();
  const willCount = COUNTED_STATUSES.includes(input.status);
  const countDelta: 1 | -1 | 0 = willCount && !order.counted ? 1 : !willCount && order.counted ? -1 : 0;
  const leadTo = leadStatusForOrder(input.status);
  const members = countDelta || input.status === "entregado" ? await getMembers(session.orgId) : [];

  await adminDb().runTransaction(async (tx) => {
    const ref = col(session.orgId, "orders").doc(id);
    const fresh = (await tx.get(ref)).data() as Order;
    if (fresh.status !== order.status) throw new ApiError(409, "El pedido cambió recién. Recargá y volvé a intentar.");
    const effects = await readCommercialEffects(tx, session, { leadId: order.leadId, customerId: order.customerId, convertProspect: input.status === "confirmado" });
    const oppEffect = await readOpportunityEffect(tx, session, order.opportunityId, input.status);
    const connectors = input.status === "confirmado" ? await readOutboxConnectors(tx, session.orgId) : [];

    tx.update(ref, {
      status: input.status,
      [`statusAt.${input.status}`]: now,
      counted: willCount,
      ...(input.status === "cancelado" ? { cancelReason: input.reason } : {}),
      updatedAt: now,
      updatedBy: session.uid,
    });
    recordActivityIn(tx, activity(session, order, "pedido.estado", `Pedido ${order.number}: ${ORDER_STATUS_LABELS[input.status]}${input.reason ? ` — ${input.reason}` : ""}`, {
      orderStatus: { before: order.status, after: input.status },
    }), now);
    if (countDelta && effects.customer) {
      tx.update(effects.customerRef, {
        stats: applyOrderToStats(effects.customer.stats, order.total, countDelta),
        ...(countDelta === 1 ? { lastPurchaseAt: now } : {}),
      });
    }
    effects.write(leadTo ? { to: leadTo } : null, now, { orderId: id });
    oppEffect?.(now);
    enqueueIn(tx, session, connectors, "order.confirmed", { ...order, status: input.status }, now);

    // El vendedor se entera de la entrega.
    const seller = members.find((m: Member) => m.id === order.sellerId);
    if (input.status === "entregado" && seller && seller.id !== session.uid && seller.notificationPrefs?.pedido_generado !== false) {
      const nRef = col(session.orgId, "notifications").doc();
      const n: Notification = {
        id: nRef.id,
        orgId: session.orgId,
        isDemo: session.org.isDemo,
        userId: seller.id,
        type: "pedido_generado",
        title: `Pedido ${order.number} entregado a ${order.customerName}`,
        link: `/pedidos/${id}`,
        read: false,
        createdAt: now,
      };
      tx.create(nRef, n);
    }
  });
  return { ...order, status: input.status };
}

export async function assignDriver(session: Session, id: string, driverId: string | null) {
  const order = await loadOrder(session, id, "asignar");
  if (order.driverId === (driverId ?? undefined)) return;
  if (order.status === "entregado" || order.status === "cancelado") throw new ApiError(409, "El pedido ya está cerrado");
  const members = await getMembers(session.orgId);
  const driver = driverId ? members.find((m) => m.id === driverId) : undefined;
  if (driverId && (!driver?.active || driver.role !== "repartidor")) throw new ApiError(422, "El repartidor no existe o está dado de baja");
  const now = Date.now();
  const batch = adminDb().batch();
  batch.update(col(session.orgId, "orders").doc(id), { driverId: driverId ?? FieldValue.delete(), updatedAt: now, updatedBy: session.uid });
  recordActivityIn(batch, activity(session, order, "pedido.repartidor", driver ? `Pedido ${order.number}: reparte ${driver.displayName}` : `Pedido ${order.number}: sin repartidor`), now);
  if (driver && driver.notificationPrefs?.nueva_asignacion !== false) {
    const nRef = col(session.orgId, "notifications").doc();
    batch.create(nRef, {
      id: nRef.id,
      orgId: session.orgId,
      isDemo: session.org.isDemo,
      userId: driver.id,
      type: "nueva_asignacion",
      title: `Tenés que entregar el pedido ${order.number} (${order.customerName})`,
      body: order.deliveryAddress,
      link: `/pedidos/${id}`,
      read: false,
      createdAt: now,
    } satisfies Notification);
  }
  await batch.commit();
}
