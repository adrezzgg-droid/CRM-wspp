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
 *  - Atómica: cliente, lead, conversación, asignación, mensaje, historial y
 *    avisos se escriben en una sola transacción.
 *
 * Asignación (en este orden):
 *  1. La conversación ya tiene responsable activo → se mantiene.
 *  2. El cliente tiene vendedor activo → se le asigna ("cliente existente").
 *  3. Reglas automáticas (settings/assignment): zona del cliente o turno rotativo
 *     entre vendedores disponibles. Si el responsable anterior fue dado de baja,
 *     también se reasigna por reglas.
 */
import { FieldValue, type DocumentReference, type Firestore, type Transaction } from "firebase-admin/firestore";
import type {
  Assignment,
  AssignmentSettings,
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
import { advanceLead, DEFAULT_ASSIGNMENT_SETTINGS, pickAssignee } from "../../lib/assignment.ts";
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
  /** Responsable final de la conversación (null = sin asignar). */
  assigneeId: string | null;
  assignmentReason?: Assignment["reason"];
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

const REASON_TEXT: Record<Assignment["reason"], string> = {
  cliente_existente: "responsable del cliente",
  regla_zona: "regla por zona",
  regla_nuevo: "turno rotativo",
  manual: "manual",
  reasignacion: "reasignación",
};

export async function ingestInbound(db: Firestore, target: IngestTarget, m: InboundMessage): Promise<IngestResult> {
  const org = db.collection("organizations").doc(target.orgId);
  const conversationId = conversationIdFor(target.accountId, m.from);
  const convRef = org.collection("conversations").doc(conversationId);
  const msgRef = convRef.collection("messages").doc(m.wamid);
  const now = Date.now();

  return db.runTransaction(async (tx) => {
    const [msgSnap, convSnap, custSnap, membersSnap, settingsSnap] = await Promise.all([
      tx.get(msgRef),
      tx.get(convRef),
      tx.get(org.collection("customers").where("whatsappId", "==", m.from).limit(1)),
      tx.get(org.collection("members").where("active", "==", true)),
      tx.get(org.collection("settings").doc("assignment")),
    ]);
    const base = { conversationId, messageId: m.wamid };
    const previous = convSnap.data() as Conversation | undefined;
    if (msgSnap.exists) {
      return { ...base, duplicate: true, customerId: previous?.customerId ?? "", newCustomer: false, newConversation: false, reopened: false, assigneeId: previous?.assigneeId ?? null };
    }
    const members = membersSnap.docs.map((d) => ({ ...(d.data() as Member), id: d.id }));
    const memberById = new Map(members.map((x) => [x.id, x]));
    const settings = { ...DEFAULT_ASSIGNMENT_SETTINGS, ...(settingsSnap.data() as Partial<AssignmentSettings> | undefined) };
    const scoped = { orgId: target.orgId, isDemo: target.isDemo };

    // ── Lecturas previas a cualquier escritura (requisito de las transacciones).
    const leadRef = previous?.leadId ? org.collection("leads").doc(previous.leadId) : null;
    const previousLead = leadRef ? ((await tx.get(leadRef)).data() as Lead | undefined) : undefined;

    // ── Cliente: se reconoce por el número; si no existe, entra como prospecto.
    let customer: Customer;
    let customerRef: DocumentReference;
    let newCustomer = false;
    if (custSnap.empty) {
      customerRef = org.collection("customers").doc();
      newCustomer = true;
      customer = {
        ...scoped,
        id: customerRef.id,
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
    } else {
      customerRef = custSnap.docs[0].ref;
      customer = { ...(custSnap.docs[0].data() as Customer), id: custSnap.docs[0].id };
    }

    // ── ¿Quién atiende?
    const reopened = !!previous && !OPEN.has(previous.status);
    const currentAssignee = previous?.assigneeId ? memberById.get(previous.assigneeId) : undefined;
    const owner = customer.ownerId ? memberById.get(customer.ownerId) : undefined;
    let assigneeId: string | null = previous?.assigneeId ?? null;
    let reason: Assignment["reason"] | undefined;

    if (!currentAssignee) {
      // Sin responsable, o el que tenía fue dado de baja (no figura entre los activos).
      if (owner && owner.role !== "repartidor" && owner.role !== "solo_lectura") {
        assigneeId = owner.id;
        reason = previous?.assigneeId ? "reasignacion" : "cliente_existente";
      } else if (settings.autoAssign) {
        const pick = pickAssignee(members, { useZones: settings.useZones, zoneFallback: settings.zoneFallback, zoneId: customer.zoneId });
        assigneeId = pick?.id ?? null;
        reason = pick?.reason;
      } else {
        assigneeId = null;
      }
      if (previous?.assigneeId && assigneeId === previous.assigneeId) reason = undefined;
    }
    const assignee = assigneeId ? memberById.get(assigneeId) : undefined;
    const changedAssignee = (previous?.assigneeId ?? null) !== assigneeId;

    // ── Cliente: alta, último contacto y, si no tenía, responsable.
    const takesCustomer = !!assignee && !owner && (reason === "regla_zona" || reason === "regla_nuevo");
    if (newCustomer) {
      tx.create(customerRef, { ...customer, ownerId: takesCustomer ? assignee!.id : null });
      activityIn(tx, org, now, { ...scoped, kind: "cliente.creado", customerId: customer.id, conversationId, summary: "Cliente creado desde WhatsApp" });
    } else {
      const patch = {
        ...(!customer.lastContactAt || customer.lastContactAt < m.timestamp ? { lastContactAt: m.timestamp } : {}),
        ...(takesCustomer ? { ownerId: assignee!.id, updatedAt: now, updatedBy: "system" } : {}),
      };
      // Un mensaje que llega fuera de orden puede no cambiar nada del cliente.
      if (Object.keys(patch).length) tx.update(customerRef, patch);
    }
    if (takesCustomer) {
      activityIn(tx, org, now, { ...scoped, kind: "cliente.asignado", customerId: customer.id, conversationId, actorId: "system", summary: `Cliente asignado a ${assignee!.displayName} (${REASON_TEXT[reason!]})`, data: { ownerId: { before: customer.ownerId ?? null, after: assignee!.id } } });
    }
    // Turno rotativo: quien recibe por regla pasa al final de la fila.
    if (takesCustomer) tx.update(org.collection("members").doc(assignee!.id), { lastAutoAssignedAt: now });

    const preview = messagePreview(m);
    const isLead = customer.stage === "prospecto";
    const newConversation = !previous;
    let leadId = previous?.leadId;

    if (newConversation) {
      if (isLead) {
        const ref = org.collection("leads").doc();
        leadId = ref.id;
        const status = assigneeId ? "asignado" : "recibido";
        const lead: Lead = {
          ...scoped,
          id: ref.id,
          customerId: customer.id,
          conversationId,
          source: "whatsapp",
          status,
          statusAt: { recibido: now, ...(assigneeId ? { asignado: now } : {}) },
          ownerId: assigneeId ?? undefined,
          createdAt: now,
          createdBy: "webhook",
          updatedAt: now,
          updatedBy: "webhook",
        };
        tx.create(ref, lead);
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
    } else if (reopened) {
      activityIn(tx, org, now, { ...scoped, kind: "conversacion.reabierta", customerId: customer.id, conversationId, leadId, summary: "El cliente volvió a escribir: conversación reabierta" });
    }

    // ── Registro de la asignación automática.
    if (changedAssignee && assignee && reason) {
      const aRef = org.collection("assignments").doc();
      const assignment: Assignment = { ...scoped, id: aRef.id, conversationId, fromId: previous?.assigneeId ?? undefined, toId: assignee.id, reason, byId: "system", at: now };
      tx.create(aRef, assignment);
      activityIn(tx, org, now, {
        ...scoped,
        kind: "conversacion.asignada",
        customerId: customer.id,
        conversationId,
        leadId,
        actorId: "system",
        summary: `Asignada a ${assignee.displayName} (${REASON_TEXT[reason]})`,
        data: { assigneeId: { before: previous?.assigneeId ?? null, after: assignee.id }, reason },
      });
      if (leadRef && previousLead) {
        const status = advanceLead(previousLead.status, "asignado");
        tx.update(leadRef, { ownerId: assignee.id, status, [`statusAt.${status}`]: previousLead.statusAt?.[status] ?? now, updatedAt: now, updatedBy: "system" });
      }
    }

    // ── Mensaje.
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

    // ── Conversación.
    const wasAwaiting = !!previous?.awaitingReply && !reopened;
    const isLatest = !previous?.lastMessageAt || previous.lastMessageAt <= m.timestamp;
    const lastInboundAt = Math.max(previous?.lastInboundAt ?? 0, m.timestamp);
    tx.update(convRef, {
      ...(isLatest ? { lastMessageAt: m.timestamp, lastMessagePreview: preview, lastMessageDirection: "in" } : {}),
      lastInboundAt,
      serviceWindowEndsAt: lastInboundAt + SERVICE_WINDOW_MS,
      awaitingReply: true,
      // La demora se mide desde el primer mensaje que quedó sin respuesta.
      ...(wasAwaiting ? {} : { awaitingSince: m.timestamp, slaAlertedAt: FieldValue.delete() }),
      unreadCount: FieldValue.increment(1),
      ...(reopened ? { status: "pendiente", closedAt: FieldValue.delete() } : {}),
      ...(changedAssignee ? { assigneeId } : {}),
      updatedAt: now,
      updatedBy: "webhook",
    });

    // ── Avisos: al responsable cuando la conversación pasa a "esperando
    // respuesta" o cuando se le acaba de asignar; si nadie la tiene, a
    // administradores y supervisores.
    const link = `/inbox?c=${conversationId}`;
    if (!wasAwaiting || changedAssignee) {
      if (assignee) {
        const reassigned = changedAssignee && !newConversation;
        const type: NotificationType = newConversation && isLead ? "nuevo_lead" : reassigned ? "nueva_asignacion" : "nuevo_mensaje";
        const title = newConversation && isLead ? `Nuevo lead: ${customer.name}` : reassigned ? `Te asignaron la conversación con ${customer.name}` : `${customer.name}: ${preview}`;
        notifyIn(tx, org, target, [assignee], type, { title, body: preview, link }, now);
      } else {
        const managers = members.filter((x) => x.role === "admin" || x.role === "supervisor");
        notifyIn(tx, org, target, managers, newConversation && isLead ? "nuevo_lead" : "cliente_esperando", {
          title: newConversation && isLead ? `Nuevo lead sin asignar: ${customer.name}` : `${customer.name} espera respuesta (sin asignar)`,
          body: preview,
          link,
        }, now);
      }
    }

    return { ...base, duplicate: false, customerId: customer.id, newCustomer, newConversation, reopened, assigneeId, assignmentReason: changedAssignee ? reason : undefined };
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
