/**
 * Ingestión de mensajes entrantes de WhatsApp. Es la ÚNICA puerta de entrada:
 * la usan el webhook real (Fase 9), el simulador demo y el seed.
 *
 * Sin dependencias de Next (recibe el Firestore por parámetro) para poder
 * usarse desde scripts y pruebas contra el emulador.
 *
 * Garantías:
 *  - Idempotente: el id del mensaje es el wamid de Meta; un reintento del
 *    webhook no duplica nada.
 *  - Atómica: cliente, lead, conversación, mensaje, historial y avisos se
 *    escriben en una sola transacción.
 */
import { FieldValue, type DocumentReference, type Firestore, type Transaction } from "firebase-admin/firestore";
import type {
  Assignment,
  Conversation,
  Customer,
  Lead,
  Member,
  Message,
  MessageAttachment,
  Notification,
  NotificationType,
} from "../../types/model.ts";
import { customerKeywords } from "../../lib/search.ts";
import { formatWhatsappId } from "../../lib/phone.ts";
import { messagePreview, SERVICE_WINDOW_MS, type InboundMessage, type StatusUpdate } from "../../lib/whatsapp/webhook.ts";

export interface IngestTarget {
  orgId: string;
  isDemo: boolean;
  /** Id del documento `whatsappAccounts` que recibió el mensaje. */
  accountId: string;
  /** Archivo ya guardado en Storage (simulador demo; en Fase 9, la descarga desde Meta). */
  storedMedia?: { storagePath: string; size: number };
}

export interface IngestResult {
  duplicate: boolean;
  conversationId: string;
  messageId: string;
  customerId: string;
  newCustomer: boolean;
  newConversation: boolean;
  reopened: boolean;
}

export const conversationIdFor = (accountId: string, waId: string) => `${accountId}_${waId}`;

const OPEN = new Set(["nueva", "pendiente", "en_atencion"]);

function activityIn(tx: Transaction, org: DocumentReference, at: number, data: Record<string, unknown>) {
  const ref = org.collection("activities").doc();
  tx.create(ref, { id: ref.id, at, actorId: "webhook", ...data });
}

function notifyIn(
  tx: Transaction,
  org: DocumentReference,
  target: IngestTarget,
  members: Member[],
  type: NotificationType,
  n: Pick<Notification, "title" | "body" | "link">,
  now: number,
) {
  for (const m of members) {
    if (!m.active || m.notificationPrefs?.[type] === false) continue;
    const ref = org.collection("notifications").doc();
    const doc: Notification = { id: ref.id, orgId: target.orgId, isDemo: target.isDemo, userId: m.id, type, read: false, createdAt: now, ...n };
    tx.create(ref, doc);
  }
}

export async function ingestInbound(db: Firestore, target: IngestTarget, m: InboundMessage): Promise<IngestResult> {
  const org = db.collection("organizations").doc(target.orgId);
  const conversationId = conversationIdFor(target.accountId, m.from);
  const convRef = org.collection("conversations").doc(conversationId);
  const msgRef = convRef.collection("messages").doc(m.wamid);
  const now = Date.now();

  return db.runTransaction(async (tx) => {
    const [msgSnap, convSnap, custSnap, membersSnap] = await Promise.all([
      tx.get(msgRef),
      tx.get(convRef),
      tx.get(org.collection("customers").where("whatsappId", "==", m.from).limit(1)),
      tx.get(org.collection("members").where("active", "==", true)),
    ]);
    const base = { conversationId, messageId: m.wamid };
    if (msgSnap.exists) {
      const conv = convSnap.data() as Conversation | undefined;
      return { ...base, duplicate: true, customerId: conv?.customerId ?? "", newCustomer: false, newConversation: false, reopened: false };
    }
    const members = membersSnap.docs.map((d) => ({ ...(d.data() as Member), id: d.id }));
    const memberById = new Map(members.map((x) => [x.id, x]));
    const scoped = { orgId: target.orgId, isDemo: target.isDemo };

    // ── Cliente: se reconoce por el número; si no existe, entra como prospecto.
    let customer: Customer;
    let newCustomer = false;
    if (custSnap.empty) {
      const ref = org.collection("customers").doc();
      newCustomer = true;
      customer = {
        ...scoped,
        id: ref.id,
        name: m.profileName?.trim() || formatWhatsappId(m.from),
        whatsappId: m.from,
        ownerId: null,
        stage: "prospecto",
        needsReactivation: false,
        tagIds: [],
        lastContactAt: m.timestamp,
        stats: { totalPurchased: 0, ordersCount: 0, avgTicket: 0 },
        archived: false,
        searchKeywords: [],
        createdAt: now,
        createdBy: "webhook",
        updatedAt: now,
        updatedBy: "webhook",
      };
      customer.searchKeywords = customerKeywords(customer);
      tx.create(ref, customer);
      activityIn(tx, org, now, { ...scoped, kind: "cliente.creado", customerId: ref.id, conversationId, summary: "Cliente creado desde WhatsApp" });
    } else {
      const doc = custSnap.docs[0];
      customer = { ...(doc.data() as Customer), id: doc.id };
      if (!customer.lastContactAt || customer.lastContactAt < m.timestamp) {
        tx.update(doc.ref, { lastContactAt: m.timestamp });
      }
    }

    const owner = customer.ownerId ? memberById.get(customer.ownerId) : undefined;
    const preview = messagePreview(m);
    const isLead = customer.stage === "prospecto";
    let newConversation = false;
    let reopened = false;
    let assigneeId: string | null;

    if (!convSnap.exists) {
      // ── Conversación nueva. Si el cliente ya tiene vendedor, queda con él.
      newConversation = true;
      assigneeId = owner ? owner.id : null;
      let leadId: string | undefined;
      if (isLead) {
        const leadRef = org.collection("leads").doc();
        leadId = leadRef.id;
        const lead: Lead = {
          ...scoped,
          id: leadRef.id,
          customerId: customer.id,
          conversationId,
          source: "whatsapp",
          status: assigneeId ? "asignado" : "recibido",
          ownerId: assigneeId ?? undefined,
          createdAt: now,
          createdBy: "webhook",
          updatedAt: now,
          updatedBy: "webhook",
        };
        tx.create(leadRef, lead);
        activityIn(tx, org, now, { ...scoped, kind: "lead.recibido", customerId: customer.id, conversationId, leadId, summary: "Lead recibido por WhatsApp" });
      }
      const conversation: Conversation = {
        ...scoped,
        id: conversationId,
        customerId: customer.id,
        whatsappAccountId: target.accountId,
        waContactId: m.from,
        contactName: customer.name,
        customerStage: customer.stage,
        status: "nueva",
        priority: "normal",
        assigneeId,
        tagIds: [],
        unreadCount: 0,
        awaitingReply: false,
        leadId,
        createdAt: now,
        createdBy: "webhook",
        updatedAt: now,
        updatedBy: "webhook",
      };
      tx.create(convRef, conversation);
      activityIn(tx, org, now, { ...scoped, kind: "conversacion.iniciada", customerId: customer.id, conversationId, leadId, summary: "Inició una conversación por WhatsApp" });
      if (owner) {
        const aRef = org.collection("assignments").doc();
        const assignment: Assignment = { ...scoped, id: aRef.id, conversationId, toId: owner.id, reason: "cliente_existente", byId: "system", at: now };
        tx.create(aRef, assignment);
        activityIn(tx, org, now, { ...scoped, kind: "conversacion.asignada", customerId: customer.id, conversationId, summary: `Asignada a ${owner.displayName} (responsable del cliente)` });
      }
    } else {
      const conv = convSnap.data() as Conversation;
      assigneeId = conv.assigneeId ?? null;
      if (!OPEN.has(conv.status)) {
        reopened = true;
        activityIn(tx, org, now, { ...scoped, kind: "conversacion.reabierta", customerId: customer.id, conversationId, summary: "El cliente volvió a escribir: conversación reabierta" });
      }
    }

    const attachments: MessageAttachment[] | undefined = m.media
      ? [{ mediaId: m.media.mediaId, mimeType: m.media.mimeType, fileName: m.media.fileName, caption: m.media.caption, ...target.storedMedia }]
      : undefined;
    const message: Message = {
      ...scoped,
      id: m.wamid,
      conversationId,
      direction: "in",
      type: m.type,
      text: m.text,
      attachments,
      location: m.location,
      interactive: m.interactive,
      sharedContacts: m.sharedContacts,
      replyToId: m.replyToId,
      senderId: "customer",
      timestamp: m.timestamp,
      createdAt: now,
    };
    tx.create(msgRef, message);

    const previous = convSnap.data() as Conversation | undefined;
    const wasAwaiting = !!previous?.awaitingReply && !reopened;
    const isLatest = !previous?.lastMessageAt || previous.lastMessageAt <= m.timestamp;
    const lastInboundAt = Math.max(previous?.lastInboundAt ?? 0, m.timestamp);
    tx.update(convRef, {
      ...(isLatest ? { lastMessageAt: m.timestamp, lastMessagePreview: preview, lastMessageDirection: "in" } : {}),
      lastInboundAt,
      serviceWindowEndsAt: lastInboundAt + SERVICE_WINDOW_MS,
      awaitingReply: true,
      unreadCount: FieldValue.increment(1),
      ...(reopened ? { status: "pendiente", closedAt: FieldValue.delete() } : {}),
      updatedAt: now,
      updatedBy: "webhook",
    });

    // ── Avisos: al responsable cuando la conversación pasa a "esperando
    // respuesta"; si nadie la tiene, a administradores y supervisores.
    const link = `/inbox?c=${conversationId}`;
    if (!wasAwaiting) {
      const assignee = assigneeId ? memberById.get(assigneeId) : undefined;
      if (assignee) {
        notifyIn(tx, org, target, [assignee], newConversation && isLead ? "nuevo_lead" : "nuevo_mensaje", { title: `${customer.name}: ${preview}`, link }, now);
      } else {
        const managers = members.filter((x) => x.role === "admin" || x.role === "supervisor");
        notifyIn(tx, org, target, managers, newConversation && isLead ? "nuevo_lead" : "cliente_esperando", {
          title: newConversation && isLead ? `Nuevo lead sin asignar: ${customer.name}` : `${customer.name} espera respuesta (sin asignar)`,
          body: preview,
          link,
        }, now);
      }
    }

    return { ...base, duplicate: false, customerId: customer.id, newCustomer, newConversation, reopened };
  });
}

const STATUS_ORDER = { sent: 1, delivered: 2, read: 3, failed: 4 } as const;

/** Estado de entrega de un mensaje enviado (solo avanza: enviado → entregado → leído). */
export async function applyStatus(db: Firestore, target: Pick<IngestTarget, "orgId" | "accountId">, s: StatusUpdate): Promise<boolean> {
  const ref = db
    .collection("organizations")
    .doc(target.orgId)
    .collection("conversations")
    .doc(conversationIdFor(target.accountId, s.recipient))
    .collection("messages")
    .doc(s.wamid);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = (snap.data() as Message | undefined)?.status;
    if (!snap.exists || (current && current !== "queued" && STATUS_ORDER[current] >= STATUS_ORDER[s.status])) return false;
    tx.update(ref, { status: s.status, ...(s.errorCode ? { errorCode: s.errorCode } : {}) });
    return true;
  });
}
