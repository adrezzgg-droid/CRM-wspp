/**
 * Historia de los últimos 60 días para la organización DEMO, para que el
 * dashboard muestre tendencias desde el primer momento.
 *
 * - Los leads entran por la MISMA ingestión que un webhook de Meta, con la
 *   fecha de entonces (reloj inyectado en `ingestInbound`).
 * - Respuestas, pedidos, entregas, oportunidades cerradas y una reactivación
 *   se escriben con la forma exacta del modelo, porque los servicios que los
 *   generan en producción dependen de una sesión de usuario.
 *
 * Es determinística (generador pseudoaleatorio con semilla fija) y solo se
 * usa sobre la organización demo.
 */
import { FieldValue, type Firestore, type WriteBatch } from "firebase-admin/firestore";
import type { Activity, Customer, CustomerKind, CustomerStage, Lead, Opportunity, Order, OrderItem, OrderStatus } from "../../src/types/model.ts";
import { buildInboundPayload, messagePreview, parseWebhook } from "../../src/lib/whatsapp/webhook.ts";
import { ingestInbound } from "../../src/server/inbox/ingest-core.ts";
import { applyOrderToStats, formatOrderNumber, orderTotal } from "../../src/lib/orders.ts";
import { msToZoned, zonedTimeToMs } from "../../src/lib/tasks.ts";
import { toWhatsappId } from "../../src/lib/phone.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const DAYS_BACK = 60;

export interface HistoryInput {
  db: Firestore;
  orgId: string;
  account: { id: string; phoneNumberId: string; displayPhone: string };
  uids: Record<string, string>;
  products: { id: string; name: string; price: number }[];
  timezone: string;
  now: number;
}

/** mulberry32: siempre la misma historia para la misma semilla. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CONTACTS = [
  "Lucas Benítez", "Rotisería El Buen Gusto", "Camila Herrera", "Almacén Don Tito", "Federico Ríos", "Bar El Cruce", "Julieta Moreno",
  "Pollería San Martín", "Matías Quiroga", "Despensa La Abuela", "Florencia Díaz", "Parrilla Los Amigos", "Nicolás Peralta", "Comedor Escolar 25",
  "Agustina Luna", "Minimercado El Sol", "Tomás Aguirre", "Restó Mediterráneo", "Rocío Villalba", "Kiosco La Parada", "Emiliano Torres",
  "Hamburguesería Fuego", "Micaela Rojas", "Supermercado Vecino", "Santiago Cabrera", "Almacén Natural", "Brenda Ibarra", "Pizzería Napoli",
  "Ezequiel Godoy", "Rotisería Doña Rosa", "Valentina Sosa", "Club Atlético Barrio", "Franco Medina", "Catering Eventos Plus", "Daniela Correa",
  "Carnicería El Novillo", "Gonzalo Vera", "Almacén 24 Horas", "Sofía Navarro", "Sandwichería Express", "Ignacio Ferreyra", "Cantina del Puerto",
  "Paula Acosta", "Granja Los Álamos", "Joaquín Ponce", "Bodegón Criollo", "Marina Paz", "Food truck La Ruta",
];

const FIRST_MESSAGES = [
  "Hola, ¿precio del cajón de pollo entero?",
  "Buenas, ¿hacen envíos a mi zona? Tengo una rotisería",
  "Hola! ¿Me pasan la lista de precios mayorista?",
  "¿Cuál es el pedido mínimo para que me lo lleven?",
  "Buen día, necesito pechuga para el fin de semana, ¿tienen?",
  "Hola, ¿venden milanesas de pollo por caja?",
  "¿Tienen alitas? Necesito unos 15 kg para el bar",
  "Consulta: ¿qué días reparten?",
];
const REPLIES = [
  "¡Hola! Sí, te paso la lista de precios ahora mismo.",
  "Buen día, sí hacemos envíos. ¿En qué barrio estás?",
  "Hola, gracias por escribirnos. ¿Qué cantidad necesitás?",
  "¡Hola! Sí tenemos. Te cuento precios y días de reparto.",
];
const LOST_REASONS = ["Precio", "Le quedaba lejos el reparto", "Compró en otro lado", "No volvió a responder"];

export async function seedHistory(input: HistoryInput) {
  const { db, orgId, uids, timezone: tz, now } = input;
  const org = db.collection("organizations").doc(orgId);
  const rand = rng(2026);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
  const between = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));
  const scoped = { orgId, isDemo: true };

  let ops = 0;
  let batch: WriteBatch = db.batch();
  const flush = async () => {
    if (ops) await batch.commit();
    batch = db.batch();
    ops = 0;
  };
  const write = async (fn: (b: WriteBatch) => void, n = 1) => {
    fn(batch);
    ops += n;
    if (ops >= 400) await flush();
  };
  const activity = (a: Omit<Activity, "id" | "orgId" | "isDemo">) => {
    const ref = org.collection("activities").doc();
    return write((b) => b.set(ref, { ...scoped, id: ref.id, ...a } satisfies Activity));
  };

  // ── Pedidos planificados (se numeran y aplican en orden cronológico al final) ──
  interface PlannedOrder {
    customerId: string;
    customerName: string;
    sellerId: string;
    at: number;
    kind: CustomerKind;
    outcome: "entregado" | "confirmado" | "cancelado";
    leadId?: string;
    conversationId?: string;
    big?: boolean;
  }
  const planned: PlannedOrder[] = [];
  const leadUpdates = new Map<string, Partial<Lead> & Record<string, unknown>>();
  const conversationEnds = new Map<string, number>();

  // ── Leads nuevos día por día, por la ingestión real ──
  const today = msToZoned(now, tz).date;
  const sellers = [uids.vendedor1, uids.vendedor2];
  let contactIndex = 0;
  let n = 0;
  let reactivationPlanned = false;
  for (let back = DAYS_BACK; back >= 1; back--) {
    const date = msToZoned(zonedTimeToMs(today, "12:00", tz) - back * DAY, tz).date;
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const count = weekday === 0 ? (rand() < 0.3 ? 1 : 0) : pick([0, 1, 1, 1, 2]);
    for (let i = 0; i < count; i++) {
      // Si se acaba la lista, se repite el nombre con otro apellido (el teléfono siempre es distinto).
      const name = contactIndex < CONTACTS.length ? CONTACTS[contactIndex] : `${CONTACTS[contactIndex % CONTACTS.length].split(" ")[0]} ${["Castro", "Ledesma", "Funes", "Bustos", "Olmos"][contactIndex % 5]}`;
      const phone = `351 7${String(10 + contactIndex).padStart(2, "0")} ${String(1000 + contactIndex * 37).slice(-4)}`;
      contactIndex += 1;
      const t0 = zonedTimeToMs(date, `${String(between(8, 19)).padStart(2, "0")}:${String(between(0, 59)).padStart(2, "0")}`, tz);
      if (t0 >= now - 6 * HOUR) continue;
      n += 1;
      const payload = buildInboundPayload({
        phoneNumberId: input.account.phoneNumberId,
        displayPhone: input.account.displayPhone,
        from: toWhatsappId(phone, "54")!,
        profileName: name,
        wamid: `wamid.hist.${n}`,
        timestamp: t0,
        message: { type: "text", text: { body: pick(FIRST_MESSAGES) } },
      });
      const [m] = parseWebhook(payload).messages;
      const r = await ingestInbound(db, { ...scoped, accountId: input.account.id }, m, t0);
      const conv = (await org.collection("conversations").doc(r.conversationId).get()).data()!;
      const leadId = conv.leadId as string | undefined;
      const seller = r.assigneeId ?? pick(sellers);
      let end = t0;

      // 88 % recibe respuesta: casi siempre rápida, a veces tarde.
      const answered = rand() < 0.88;
      if (!answered) {
        conversationEnds.set(r.conversationId, t0 + 2 * DAY);
        continue;
      }
      const u = rand();
      const delay = (u < 0.6 ? between(2, 20) : u < 0.9 ? between(20, 90) : between(90, 420)) * 60_000;
      const tr = t0 + delay;
      end = tr;
      const text = pick(REPLIES);
      const msgRef = org.collection("conversations").doc(r.conversationId).collection("messages").doc(`wamid.demo.hist${n}`);
      await write((b) => {
        b.set(msgRef, { ...scoped, id: msgRef.id, conversationId: r.conversationId, direction: "out", type: "text", text, senderId: seller, status: "read", timestamp: tr, createdAt: tr });
        b.update(org.collection("conversations").doc(r.conversationId), {
          lastMessageAt: tr,
          lastMessagePreview: messagePreview({ type: "text", text }),
          lastMessageDirection: "out",
          awaitingReply: false,
          awaitingSince: FieldValue.delete(),
          unreadCount: 0,
          status: "en_atencion",
          firstResponseAt: tr,
        });
      }, 2);
      await activity({ at: tr, kind: "conversacion.respondida", customerId: r.customerId, conversationId: r.conversationId, leadId, actorId: seller, summary: "Respondió por primera vez" });
      const leadPatch: Record<string, unknown> = { firstResponseAt: tr, status: "contactado", "statusAt.contactado": tr, updatedAt: tr };

      // 45 % de los atendidos compra (uno de los primeros, además, se reactiva después).
      if (rand() < 0.45) {
        const tc = tr + between(2, 40) * HOUR;
        if (tc < now - 2 * HOUR) {
          if (rand() < 0.6) leadPatch["statusAt.en_negociacion"] = tc - HOUR;
          const outcome = rand() < 0.06 ? "cancelado" : "entregado";
          planned.push({ customerId: r.customerId, customerName: name, sellerId: seller, at: tc, kind: "nuevo", outcome, leadId, conversationId: r.conversationId });
          end = tc;
          if (outcome === "cancelado") {
            // Sin compra efectiva no hay repetición ni reactivación.
          } else if (!reactivationPlanned && back >= 45) {
            reactivationPlanned = true;
            planned.push({ customerId: r.customerId, customerName: name, sellerId: seller, at: now - between(8, 12) * DAY, kind: "reactivado", outcome: "entregado" });
          } else if (rand() < 0.35) {
            const again = tc + between(6, 20) * DAY;
            if (again < now - 2 * HOUR) planned.push({ customerId: r.customerId, customerName: name, sellerId: seller, at: again, kind: "recurrente", outcome: "entregado" });
          }
          // La mitad venía de una oportunidad del pipeline, que quedó ganada.
          if (rand() < 0.5) {
            const oRef = org.collection("opportunities").doc();
            await write((b) =>
              b.set(oRef, {
                ...scoped,
                id: oRef.id,
                customerId: r.customerId,
                customerName: name,
                leadId,
                conversationId: r.conversationId,
                ownerId: seller,
                pipelineId: "principal",
                stageId: "venta",
                estimatedValue: between(6, 30) * 10_000,
                probability: 100,
                stageChangedAt: tc,
                closedAt: tc,
                createdAt: tr,
                createdBy: seller,
                updatedAt: tc,
                updatedBy: seller,
              } satisfies Opportunity),
            );
          }
        }
      } else if (rand() < 0.2) {
        // Algunos se pierden después de la primera charla.
        const tl = tr + between(1, 5) * DAY;
        if (tl < now) {
          const reason = pick(LOST_REASONS);
          Object.assign(leadPatch, { status: "perdido", "statusAt.perdido": tl, lostReason: reason, updatedAt: tl });
          await activity({ at: tl, kind: "lead.estado", customerId: r.customerId, conversationId: r.conversationId, leadId, actorId: seller, summary: `Lead: Perdido — ${reason}` });
          if (rand() < 0.5) {
            const oRef = org.collection("opportunities").doc();
            await write((b) =>
              b.set(oRef, {
                ...scoped,
                id: oRef.id,
                customerId: r.customerId,
                customerName: name,
                leadId,
                ownerId: seller,
                pipelineId: "principal",
                stageId: "perdido",
                estimatedValue: between(5, 20) * 10_000,
                probability: 0,
                stageChangedAt: tl,
                closedAt: tl,
                lostReason: reason,
                createdAt: tr,
                createdBy: seller,
                updatedAt: tl,
                updatedBy: seller,
              } satisfies Opportunity),
            );
          }
          end = tl;
        }
      }
      if (leadId) leadUpdates.set(leadId, leadPatch);
      conversationEnds.set(r.conversationId, end + DAY);
    }
  }

  // ── Compras de los clientes que ya existían ──
  const existing = (key: number, seller: string, name: string) => ({ customerId: `demo-cliente-${key}`, customerName: name, sellerId: uids[seller] });
  for (let back = 56; back >= 2; back -= 7) {
    planned.push({ ...existing(1, "vendedor1", "José Fernández"), at: now - back * DAY - 5 * HOUR, kind: "recurrente", outcome: back === 28 ? "cancelado" : "entregado" });
  }
  planned.push({ ...existing(1, "vendedor1", "José Fernández"), at: now - 20 * HOUR, kind: "recurrente", outcome: "confirmado" });
  for (let back = 55; back >= 5; back -= 10) planned.push({ ...existing(6, "vendedor2", "Carolina Vega"), at: now - back * DAY - 3 * HOUR, kind: "recurrente", outcome: "entregado", big: true });
  planned.push({ ...existing(3, "vendedor1", "Ricardo Sosa"), at: now - 20 * DAY, kind: "nuevo", outcome: "entregado" });
  planned.push({ ...existing(7, "vendedor2", "Pablo Giménez"), at: now - 3 * DAY, kind: "nuevo", outcome: "entregado" });
  planned.push({ ...existing(4, "vendedor1", "Marta López"), at: now - 75 * DAY, kind: "recurrente", outcome: "entregado" });
  planned.push({ ...existing(4, "vendedor1", "Marta López"), at: now - 52 * DAY, kind: "recurrente", outcome: "entregado" });
  planned.push({ ...existing(8, "vendedor2", "Silvia Ortiz"), at: now - 58 * DAY, kind: "recurrente", outcome: "entregado" });

  // ── Pedidos en orden cronológico: numeración, estadísticas y recorrido del lead ──
  planned.sort((a, b) => a.at - b.at);
  const customers = new Map<string, Customer>();
  for (const id of new Set(planned.map((p) => p.customerId))) customers.set(id, (await org.collection("customers").doc(id).get()).data() as Customer);
  let counter = 0;
  for (const p of planned) {
    counter += 1;
    const items: OrderItem[] = Array.from({ length: between(1, 3) }, () => pick(input.products)).map((prod) => ({
      productId: prod.id,
      name: prod.name,
      qty: p.big ? between(30, 80) : between(5, 30),
      unitPrice: prod.price,
    }));
    const total = orderTotal(items);
    const statusAt: Partial<Record<OrderStatus, number>> = { borrador: p.at, confirmado: p.at };
    let status: OrderStatus = "confirmado";
    if (p.outcome === "cancelado") {
      statusAt.cancelado = p.at + 4 * HOUR;
      status = "cancelado";
    } else if (p.outcome === "entregado" && p.at + 22 * HOUR < now) {
      Object.assign(statusAt, { en_preparacion: p.at + 3 * HOUR, en_reparto: p.at + 18 * HOUR, entregado: p.at + 22 * HOUR });
      status = "entregado";
    }
    const ref = org.collection("orders").doc();
    const order: Order = {
      ...scoped,
      id: ref.id,
      number: formatOrderNumber(counter),
      customerId: p.customerId,
      customerName: p.customerName,
      sellerId: p.sellerId,
      ...(status === "entregado" ? { driverId: uids.repartidor } : {}),
      ...(p.conversationId ? { conversationId: p.conversationId } : {}),
      ...(p.leadId ? { leadId: p.leadId } : {}),
      items,
      total,
      currency: "ARS",
      status,
      statusAt,
      counted: status !== "cancelado",
      customerKind: p.kind,
      ...(status === "cancelado" ? { cancelReason: "El cliente lo pidió para otra fecha" } : {}),
      createdAt: p.at,
      createdBy: p.sellerId,
      updatedAt: Math.max(...Object.values(statusAt)),
      updatedBy: p.sellerId,
    };
    await write((b) => b.set(ref, order));
    const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(total);
    await activity({ at: p.at, kind: "pedido.confirmado", customerId: p.customerId, conversationId: p.conversationId, leadId: p.leadId, orderId: ref.id, actorId: p.sellerId, summary: `Pedido ${order.number} confirmado por ${money}` });
    if (status === "cancelado") {
      await activity({ at: statusAt.cancelado!, kind: "pedido.estado", customerId: p.customerId, orderId: ref.id, actorId: p.sellerId, summary: `Pedido ${order.number}: Cancelado — ${order.cancelReason}` });
      continue;
    }
    const c = customers.get(p.customerId)!;
    // Primera compra: prospecto → cliente nuevo. Repetir: cliente nuevo → activo.
    // Los clientes del seed que hoy están inactivos o perdidos (compras viejas) conservan su etapa.
    const nextStage: CustomerStage =
      p.kind === "reactivado" ? "cliente_activo" : p.kind === "nuevo" ? (c.stage === "prospecto" ? "cliente_nuevo" : c.stage) : c.stage === "cliente_nuevo" ? "cliente_activo" : c.stage;
    if (p.kind === "reactivado") {
      await activity({ at: p.at, kind: "cliente.reactivado", customerId: p.customerId, orderId: ref.id, actorId: p.sellerId, summary: "Cliente reactivado: volvió a comprar (estaba marcado para reactivar)" });
    } else if (nextStage !== c.stage) {
      await activity({ at: p.at, kind: "cliente.etapa", customerId: p.customerId, orderId: ref.id, actorId: p.sellerId, summary: "Etapa: Cliente nuevo (primera compra)" });
    }
    customers.set(p.customerId, { ...c, stage: nextStage, stats: applyOrderToStats(c.stats, total, 1), lastPurchaseAt: p.at });
    if (p.leadId) {
      const patch = leadUpdates.get(p.leadId) ?? {};
      Object.assign(patch, { status: status === "entregado" ? "venta_realizada" : "pedido_generado", "statusAt.pedido_generado": p.at, updatedAt: p.at });
      if (status === "entregado") patch["statusAt.venta_realizada"] = statusAt.entregado;
      leadUpdates.set(p.leadId, patch);
    }
  }

  // Los clientes generados con una sola compra vieja quedan como "cliente nuevo";
  // los que repitieron, activos. Los que ya existían conservan su etapa del seed
  // salvo que hayan comprado por primera vez (Ricardo, Pablo).
  for (const [id, c] of customers) {
    await write((b) => b.update(org.collection("customers").doc(id), { stage: c.stage, stats: c.stats, ...(c.lastPurchaseAt ? { lastPurchaseAt: c.lastPurchaseAt } : {}) }));
    const convs = await org.collection("conversations").where("customerId", "==", id).get();
    for (const d of convs.docs) await write((b) => b.update(d.ref, { customerStage: c.stage }));
  }
  for (const [id, patch] of leadUpdates) await write((b) => b.update(org.collection("leads").doc(id), patch));
  // Conversaciones viejas: cerradas un día después del último movimiento.
  for (const [id, closedAt] of conversationEnds) {
    if (closedAt < now - 12 * HOUR) await write((b) => b.update(org.collection("conversations").doc(id), { status: "cerrada", closedAt, awaitingReply: false, awaitingSince: FieldValue.delete(), unreadCount: 0 }));
  }
  await write((b) => b.set(org.collection("settings").doc("counters"), { orders: counter }, { merge: true }));
  await flush();

  // Los avisos que generó la ingestión de la historia no tienen sentido hoy.
  const oldNotifications = await org.collection("notifications").where("createdAt", "<", now - HOUR).get();
  for (const d of oldNotifications.docs) await write((b) => b.delete(d.ref));
  await flush();

  return { leads: n, orders: planned.length };
}
