import "server-only";
import { randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import type { z } from "zod";
import type {
  WhatsappTemplate,
  Assignment,
  Conversation,
  Customer,
  Lead,
  Member,
  Message,
  MessageAttachment,
  MessageType,
  Notification,
  WhatsappAccount,
} from "@/types/model";
import { CONVERSATION_STATUS_LABELS, orgPath } from "@/types/model";
import { adminBucket, adminDb } from "@/server/firebase/admin";
import { ApiError } from "@/server/api/handler";
import { recordActivityIn, type ActivityEntry } from "@/server/audit";
import { can, type Action } from "@/server/permissions/matrix";
import { scopeAllows } from "@/server/permissions/scope";
import type { Session } from "@/server/auth/session";
import { getGeneralSettings, getMembers, getTags, getTeams, OWNER_ROLES, scopeContext } from "@/server/org/data";
import { buildInboundPayload, isWindowOpen, messagePreview, parseWebhook, type MetaMessage } from "@/lib/whatsapp/webhook";
import { toWhatsappId } from "@/lib/phone";
import { advanceLead } from "@/lib/assignment";
import type { assignInput, conversationUpdate, demoInboundInput } from "@/lib/schemas";
import { ingestInbound, type IngestResult } from "./ingest-core";
import { fireAutomations } from "@/server/automations/run";
import { renderTemplate, toMetaBody } from "@/lib/templates";
import { senderFor, type OutboundMedia } from "./sender";

const col = (orgId: string, c: Parameters<typeof orgPath>[1]) => adminDb().collection(orgPath(orgId, c));
const convRef = (orgId: string, id: string) => col(orgId, "conversations").doc(id);

function requireInbox(session: Session, action: Action) {
  if (!can(session.role, "inbox", action, session.overrides)) {
    throw new ApiError(403, "No tenés permiso para esta acción en la bandeja");
  }
}

function activity(session: Session, conv: Conversation, kind: string, summary: string, data?: Record<string, unknown>): ActivityEntry {
  return {
    orgId: session.orgId,
    isDemo: session.org.isDemo,
    customerId: conv.customerId,
    conversationId: conv.id,
    leadId: conv.leadId,
    kind,
    summary,
    actorId: session.uid,
    data,
  };
}

/** Conversación dentro del alcance del usuario o 404. */
export async function loadConversation(session: Session, id: string, action: Action = "ver"): Promise<Conversation> {
  requireInbox(session, action);
  const snap = await convRef(session.orgId, id).get();
  if (!snap.exists) throw new ApiError(404, "Conversación no encontrada");
  const conv = { ...(snap.data() as Conversation), id: snap.id };
  if (!scopeAllows(await scopeContext(session, "inbox"), conv.assigneeId)) {
    throw new ApiError(404, "Conversación no encontrada");
  }
  return conv;
}

function assertWindow(conv: Conversation) {
  if (!isWindowOpen(conv.serviceWindowEndsAt)) {
    throw new ApiError(
      409,
      "Pasaron más de 24 h desde el último mensaje del cliente. Meta solo permite escribirle con una plantilla aprobada (se habilitan en la Fase 7). Podés dejar una nota interna.",
    );
  }
}

// ──────────────────────────────── Salida ───────────────────────────────────

/**
 * Registra un mensaje saliente ya enviado: conversación atendida, primera
 * respuesta del lead, historial. Todo en una transacción.
 */
async function recordOutbound(session: Session, conv: Conversation, message: Message): Promise<void> {
  const now = message.createdAt;
  await adminDb().runTransaction(async (tx) => {
    const ref = convRef(session.orgId, conv.id);
    const leadRef = conv.leadId ? col(session.orgId, "leads").doc(conv.leadId) : null;
    const [fresh, leadSnap] = await Promise.all([tx.get(ref), leadRef ? tx.get(leadRef) : Promise.resolve(null)]);
    const current = fresh.data() as Conversation;
    const firstResponse = !current.firstResponseAt;

    tx.create(ref.collection("messages").doc(message.id), message);
    tx.update(ref, {
      lastMessageAt: message.timestamp,
      lastMessagePreview: messagePreview(message),
      lastMessageDirection: "out",
      awaitingReply: false,
      // Se respondió: termina la espera (y su alerta de demora).
      awaitingSince: FieldValue.delete(),
      slaAlertedAt: FieldValue.delete(),
      unreadCount: 0,
      // Escribirle al cliente la deja "en atención" (también si estaba cerrada).
      ...(current.status !== "en_atencion" ? { status: "en_atencion" } : {}),
      ...(current.status === "cerrada" ? { closedAt: FieldValue.delete() } : {}),
      ...(firstResponse ? { firstResponseAt: now } : {}),
      updatedAt: now,
      updatedBy: session.uid,
    });
    tx.update(col(session.orgId, "customers").doc(conv.customerId), { lastContactAt: now });
    if (current.status === "cerrada") {
      recordActivityIn(tx, activity(session, conv, "conversacion.reabierta", `${session.member.displayName} le escribió al cliente: conversación reabierta`), now);
    }

    if (firstResponse) {
      recordActivityIn(tx, activity(session, conv, "conversacion.respondida", `${session.member.displayName} respondió por primera vez`), now);
    }
    const lead = leadSnap?.data() as Lead | undefined;
    if (leadRef && lead && !lead.firstResponseAt) {
      const status = advanceLead(lead.status, "contactado");
      const advanced = status !== lead.status;
      tx.update(leadRef, {
        firstResponseAt: now,
        ...(advanced ? { status, "statusAt.contactado": now } : {}),
        updatedAt: now,
        updatedBy: session.uid,
      });
      if (advanced) recordActivityIn(tx, activity(session, conv, "lead.contactado", "Lead contactado"), now);
    }
  });
}

function outboundMessage(session: Session, conv: Conversation, id: string, type: MessageType, extra: Partial<Message>): Message {
  const now = Date.now();
  return {
    orgId: session.orgId,
    isDemo: session.org.isDemo,
    id,
    conversationId: conv.id,
    direction: "out",
    type,
    senderId: session.uid,
    status: "sent",
    timestamp: now,
    createdAt: now,
    ...extra,
  };
}

export async function sendText(session: Session, conversationId: string, text: string): Promise<Message> {
  const conv = await loadConversation(session, conversationId, "editar");
  assertWindow(conv);
  const { wamid } = await senderFor(session.org).sendText(conv.waContactId, text);
  const message = outboundMessage(session, conv, wamid, "text", { text });
  await recordOutbound(session, conv, message);
  return message;
}

/**
 * Plantilla aprobada por Meta. Es la única forma de escribirle al cliente
 * fuera de la ventana de 24 h. Las variables las completa quien envía.
 */
export async function sendTemplate(session: Session, conversationId: string, templateId: string, values: Record<string, string>): Promise<Message> {
  const conv = await loadConversation(session, conversationId, "editar");
  const snap = await col(session.orgId, "whatsappTemplates").doc(templateId).get();
  const tpl = snap.data() as WhatsappTemplate | undefined;
  if (!tpl) throw new ApiError(404, "Plantilla no encontrada");
  if (tpl.metaStatus !== "aprobada") throw new ApiError(409, "La plantilla todavía no está aprobada por Meta");
  const { order } = toMetaBody(tpl.body);
  const missing = order.filter((v) => !values[v]?.trim());
  if (missing.length) throw new ApiError(422, `Completá: ${missing.map((m) => `{{${m}}}`).join(", ")}`);
  const text = renderTemplate(tpl.body, values);
  const { wamid } = await senderFor(session.org).sendTemplate(conv.waContactId, { name: tpl.name, language: tpl.language, params: order.map((v) => values[v]) });
  const message = outboundMessage(session, conv, wamid, "template", { text, templateName: tpl.name });
  await recordOutbound(session, conv, message);
  return message;
}

/** Nota interna: queda en el chat para el equipo; el cliente no la ve. */
export async function addNote(session: Session, conversationId: string, text: string): Promise<Message> {
  const conv = await loadConversation(session, conversationId, "editar");
  const ref = convRef(session.orgId, conv.id).collection("messages").doc();
  const now = Date.now();
  const message: Message = {
    orgId: session.orgId,
    isDemo: session.org.isDemo,
    id: ref.id,
    conversationId: conv.id,
    direction: "internal",
    type: "internal_note",
    text,
    senderId: session.uid,
    timestamp: now,
    createdAt: now,
  };
  const batch = adminDb().batch();
  batch.create(ref, message);
  batch.update(convRef(session.orgId, conv.id), { updatedAt: now, updatedBy: session.uid });
  await batch.commit();
  return message;
}

// ─────────────────────────────── Adjuntos ──────────────────────────────────

/** Tipos y tamaños que acepta WhatsApp Cloud API. */
const MEDIA_RULES: { kind: OutboundMedia["kind"]; mimes: string[]; maxBytes: number }[] = [
  { kind: "image", mimes: ["image/jpeg", "image/png"], maxBytes: 5 * 1024 * 1024 },
  { kind: "video", mimes: ["video/mp4", "video/3gpp"], maxBytes: 16 * 1024 * 1024 },
  { kind: "audio", mimes: ["audio/aac", "audio/mp4", "audio/mpeg", "audio/amr", "audio/ogg"], maxBytes: 16 * 1024 * 1024 },
  {
    kind: "document",
    mimes: [
      "application/pdf",
      "text/plain",
      "text/csv",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ],
    maxBytes: 16 * 1024 * 1024,
  },
];

export function mediaKindFor(mimeType: string, size: number): OutboundMedia["kind"] {
  const base = mimeType.split(";")[0].trim().toLowerCase();
  const rule = MEDIA_RULES.find((r) => r.mimes.includes(base));
  if (!rule) throw new ApiError(415, "Ese tipo de archivo no se puede enviar por WhatsApp. Usá JPG, PNG, PDF, Word, Excel, MP3, MP4…");
  if (size > rule.maxBytes) throw new ApiError(413, `El archivo supera el máximo de ${rule.maxBytes / 1024 / 1024} MB para este tipo.`);
  return rule.kind;
}

function safeFileName(name: string): string {
  const clean = name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.\-]+/g, "_").slice(-100);
  return clean || "archivo";
}

async function storeFile(orgId: string, conversationId: string, file: File): Promise<{ storagePath: string; size: number }> {
  const storagePath = `orgs/${orgId}/conversations/${conversationId}/${randomUUID()}/${safeFileName(file.name)}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  await adminBucket().file(storagePath).save(buffer, { contentType: file.type, resumable: false });
  return { storagePath, size: buffer.length };
}

export async function sendAttachment(session: Session, conversationId: string, file: File, caption?: string): Promise<Message> {
  const conv = await loadConversation(session, conversationId, "editar");
  assertWindow(conv);
  const kind = mediaKindFor(file.type, file.size);
  const stored = await storeFile(session.orgId, conv.id, file);
  const attachment: MessageAttachment = { ...stored, mimeType: file.type, fileName: file.name, caption };
  const { wamid } = await senderFor(session.org).sendMedia(conv.waContactId, {
    kind,
    storagePath: stored.storagePath,
    mimeType: file.type,
    fileName: file.name,
    caption,
  });
  const message = outboundMessage(session, conv, wamid, kind, { text: caption, attachments: [attachment] });
  await recordOutbound(session, conv, message);
  return message;
}

/** Descarga de un adjunto, solo si la conversación está en el alcance del usuario. */
export async function getAttachment(session: Session, conversationId: string, messageId: string, index: number) {
  const conv = await loadConversation(session, conversationId, "ver");
  const snap = await convRef(session.orgId, conv.id).collection("messages").doc(messageId).get();
  const attachment = (snap.data() as Message | undefined)?.attachments?.[index];
  if (!attachment) throw new ApiError(404, "Archivo no encontrado");
  if (!attachment.storagePath) {
    throw new ApiError(404, "El archivo todavía está en WhatsApp: se descarga automáticamente cuando se conecte la cuenta (Fase 9).");
  }
  const [buffer] = await adminBucket().file(attachment.storagePath).download();
  return { buffer, mimeType: attachment.mimeType, fileName: attachment.fileName ?? "archivo" };
}

// ─────────────────────────── Estado y asignación ───────────────────────────

export async function markRead(session: Session, conversationId: string): Promise<void> {
  const conv = await loadConversation(session, conversationId, "ver");
  // Solo quien la atiende (o, si no tiene responsable, quien puede asignarla)
  // la marca como leída: que la mire un supervisor no apaga el aviso del vendedor.
  const mine = conv.assigneeId === session.uid || (!conv.assigneeId && can(session.role, "inbox", "asignar", session.overrides));
  if (!mine || conv.unreadCount === 0) return;
  await convRef(session.orgId, conv.id).update({ unreadCount: 0 });
}

export async function updateConversation(session: Session, conversationId: string, input: z.output<typeof conversationUpdate>) {
  const conv = await loadConversation(session, conversationId, "editar");
  if (input.tagIds?.length) {
    const known = new Set((await getTags(session.orgId)).map((t) => t.id));
    if (input.tagIds.some((t) => !known.has(t))) throw new ApiError(422, "Hay etiquetas que no existen");
  }
  const now = Date.now();
  const patch: Record<string, unknown> = { updatedAt: now, updatedBy: session.uid };
  const batch = adminDb().batch();

  if (input.status && input.status !== conv.status) {
    patch.status = input.status;
    if (input.status === "cerrada") {
      patch.closedAt = now;
      patch.awaitingReply = false;
      recordActivityIn(batch, activity(session, conv, "conversacion.cerrada", "Conversación cerrada"), now);
    } else {
      if (conv.status === "cerrada") patch.closedAt = FieldValue.delete();
      recordActivityIn(batch, activity(session, conv, "conversacion.estado", `Estado: ${CONVERSATION_STATUS_LABELS[input.status]}`, { status: { before: conv.status, after: input.status } }), now);
    }
  }
  if (input.priority && input.priority !== conv.priority) {
    patch.priority = input.priority;
    recordActivityIn(batch, activity(session, conv, "conversacion.prioridad", `Prioridad: ${input.priority}`, { priority: { before: conv.priority, after: input.priority } }), now);
  }
  if (input.tagIds) {
    patch.tagIds = [...new Set(input.tagIds)];
    recordActivityIn(batch, activity(session, conv, "conversacion.etiquetas", "Etiquetas de la conversación actualizadas", { tagIds: { before: conv.tagIds, after: patch.tagIds } }), now);
  }
  batch.update(convRef(session.orgId, conv.id), patch);
  await batch.commit();
}

/**
 * Asignación manual a una persona y/o a un equipo. Asignar a alguien de un
 * equipo distinto al de la conversación la mueve a ese equipo.
 */
export async function assignConversation(session: Session, conversationId: string, input: z.output<typeof assignInput>) {
  const conv = await loadConversation(session, conversationId, "asignar");
  const ctx = await scopeContext(session, "inbox");
  const members = await getMembers(session.orgId);
  const teams = await getTeams(session.orgId);

  const assigneeId = input.assigneeId === undefined ? conv.assigneeId : input.assigneeId;
  let teamId = input.teamId === undefined ? (conv.teamId ?? null) : input.teamId;

  let assignee: Member | undefined;
  if (assigneeId && assigneeId !== conv.assigneeId) {
    assignee = members.find((m) => m.id === assigneeId);
    if (!assignee?.active || !OWNER_ROLES.has(assignee.role)) {
      throw new ApiError(422, "El usuario no está activo o no puede atender conversaciones");
    }
    if (!scopeAllows(ctx, assigneeId)) throw new ApiError(403, "Solo podés asignar conversaciones dentro de tu equipo");
    // Si la persona no está en el equipo elegido, la conversación pasa a uno suyo.
    const own = teams.filter((t) => t.memberIds.includes(assigneeId) || t.leaderIds.includes(assigneeId));
    if (teamId && !own.some((t) => t.id === teamId)) teamId = own[0]?.id ?? null;
    if (!teamId && own.length === 1) teamId = own[0].id;
  }
  if (teamId && teamId !== conv.teamId) {
    const team = teams.find((t) => t.id === teamId);
    if (!team) throw new ApiError(422, "El equipo no existe");
    if (ctx.scope === "equipo" && !team.leaderIds.includes(session.uid)) throw new ApiError(403, "Solo podés asignar a equipos que supervisás");
  }
  const personChanged = assigneeId !== conv.assigneeId;
  const teamChanged = (teamId ?? null) !== (conv.teamId ?? null);
  if (!personChanged && !teamChanged) return;

  const now = Date.now();
  const teamName = teamId ? teams.find((t) => t.id === teamId)?.name : undefined;
  await adminDb().runTransaction(async (tx) => {
    const customerRef = col(session.orgId, "customers").doc(conv.customerId);
    const leadRef = conv.leadId ? col(session.orgId, "leads").doc(conv.leadId) : null;
    const [customerSnap, leadSnap] = await Promise.all([tx.get(customerRef), leadRef ? tx.get(leadRef) : Promise.resolve(null)]);

    tx.update(convRef(session.orgId, conv.id), { assigneeId, teamId: teamId ?? FieldValue.delete(), updatedAt: now, updatedBy: session.uid });
    const aRef = col(session.orgId, "assignments").doc();
    const assignment: Assignment = {
      orgId: session.orgId,
      isDemo: session.org.isDemo,
      id: aRef.id,
      conversationId: conv.id,
      fromId: conv.assigneeId ?? undefined,
      toId: assigneeId ?? undefined,
      toTeamId: teamId ?? undefined,
      reason: conv.assigneeId ? "reasignacion" : "manual",
      byId: session.uid,
      at: now,
    };
    tx.create(aRef, assignment);
    const who = assignee?.displayName ?? (assigneeId ? members.find((m) => m.id === assigneeId)?.displayName : undefined);
    const summary = personChanged
      ? who ? `Asignada a ${who}${teamName ? ` (equipo ${teamName})` : ""}` : `Quedó sin responsable${teamName ? ` en el equipo ${teamName}` : ""}`
      : teamName ? `Pasó al equipo ${teamName}` : "Quedó sin equipo";
    recordActivityIn(tx, activity(session, conv, "conversacion.asignada", summary, {
      ...(personChanged ? { assigneeId: { before: conv.assigneeId, after: assigneeId } } : {}),
      ...(teamChanged ? { teamId: { before: conv.teamId ?? null, after: teamId } } : {}),
    }), now);

    // Un cliente sin responsable pasa a ser del vendedor que lo atiende.
    const customer = customerSnap.data() as Customer | undefined;
    if (assignee && customer && !customer.ownerId) {
      tx.update(customerRef, { ownerId: assignee.id, updatedAt: now, updatedBy: session.uid });
      recordActivityIn(tx, activity(session, conv, "cliente.asignado", `Cliente asignado a ${assignee.displayName}`, { ownerId: { before: null, after: assignee.id } }), now);
    }
    const lead = leadSnap?.data() as Lead | undefined;
    if (leadRef && lead && assignee) {
      const status = advanceLead(lead.status, "asignado");
      tx.update(leadRef, {
        ownerId: assignee.id,
        ...(status !== lead.status ? { status, "statusAt.asignado": now } : {}),
        updatedAt: now,
        updatedBy: session.uid,
      });
    }
    if (assignee && assignee.id !== session.uid && assignee.notificationPrefs?.nueva_asignacion !== false) {
      const nRef = col(session.orgId, "notifications").doc();
      const n: Notification = {
        orgId: session.orgId,
        isDemo: session.org.isDemo,
        id: nRef.id,
        userId: assignee.id,
        type: "nueva_asignacion",
        title: `Te asignaron la conversación con ${conv.contactName}`,
        body: conv.lastMessagePreview,
        link: `/inbox?c=${conv.id}`,
        read: false,
        createdAt: now,
      };
      tx.create(nRef, n);
    }
  });
}

// ──────────────────────────── Simulador demo ───────────────────────────────

const DEMO_ACCOUNT_ID = "demo";

/** Cuenta de WhatsApp ficticia de la organización demo (se crea al primer uso). */
export async function ensureDemoAccount(session: Session): Promise<WhatsappAccount> {
  const ref = col(session.orgId, "whatsappAccounts").doc(DEMO_ACCOUNT_ID);
  const snap = await ref.get();
  if (snap.exists) return snap.data() as WhatsappAccount;
  const now = Date.now();
  const account: WhatsappAccount = {
    orgId: session.orgId,
    isDemo: true,
    id: DEMO_ACCOUNT_ID,
    displayPhone: "+54 9 351 000-0000 (demo)",
    phoneNumberId: `demo-${session.orgId}`,
    wabaId: "demo",
    verifyTokenSet: false,
    tokenSet: false,
    connectionStatus: "sin_configurar",
    webhookStatus: "sin_verificar",
    createdAt: now,
    createdBy: "system",
    updatedAt: now,
    updatedBy: "system",
  };
  await ref.set(account);
  return account;
}

/**
 * Mensaje entrante simulado. Arma el mismo JSON que manda Meta y lo pasa por
 * el parser y la ingestión reales. Solo existe en organizaciones demo.
 */
export async function simulateInbound(session: Session, input: z.output<typeof demoInboundInput>, file?: File): Promise<IngestResult> {
  if (!session.org.isDemo) throw new ApiError(403, "El simulador solo está disponible en el modo demo");
  requireInbox(session, "ver");
  const { defaultCountryCode } = await getGeneralSettings(session.orgId);
  const from = toWhatsappId(input.phone, defaultCountryCode);
  if (!from) throw new ApiError(422, "Número inválido", [{ path: ["phone"], message: "No se reconoce el número" }]);

  const account = await ensureDemoAccount(session);
  const wamid = `wamid.sim.${randomUUID()}`;
  let storedMedia: { storagePath: string; size: number } | undefined;
  let message: Omit<MetaMessage, "from" | "id" | "timestamp">;

  switch (input.type) {
    case "image":
    case "document":
    case "audio":
    case "video": {
      if (!file) throw new ApiError(422, "Adjuntá un archivo para simular ese tipo de mensaje");
      const kind = mediaKindFor(file.type, file.size);
      if (kind !== input.type) throw new ApiError(422, `El archivo no es de tipo ${input.type}`);
      storedMedia = await storeFile(session.orgId, `${account.id}_${from}`, file);
      const media = { id: `media.sim.${randomUUID()}`, mime_type: file.type, caption: input.text, filename: input.type === "document" ? file.name : undefined };
      message = { type: input.type, [input.type]: media };
      break;
    }
    case "location":
      message = { type: "location", location: { latitude: input.lat ?? -31.4201, longitude: input.lng ?? -64.1888, name: input.placeName ?? "Ubicación compartida" } };
      break;
    case "contacts":
      message = { type: "contacts", contacts: [{ name: { formatted_name: input.text ?? "Contacto" }, phones: [{ phone: "+54 9 351 555-0000", wa_id: "5493515550000" }] }] };
      break;
    case "button_reply":
    case "list_reply": {
      const reply = { id: `opcion-${randomUUID().slice(0, 6)}`, title: input.text ?? "Sí, confirmo" };
      message = { type: "interactive", interactive: input.type === "button_reply" ? { type: "button_reply", button_reply: reply } : { type: "list_reply", list_reply: reply } };
      break;
    }
    default:
      message = { type: "text", text: { body: input.text ?? "Hola" } };
  }

  const payload = buildInboundPayload({
    phoneNumberId: account.phoneNumberId,
    displayPhone: account.displayPhone,
    from,
    profileName: input.name,
    wamid,
    timestamp: Date.now(),
    message,
  });
  const [parsed] = parseWebhook(payload).messages;
  if (!parsed) throw new ApiError(422, "El mensaje simulado no es válido");
  const result = await ingestInbound(adminDb(), { orgId: session.orgId, isDemo: true, accountId: account.id, storedMedia }, parsed);
  if (!result.duplicate && result.newConversation) {
    await fireAutomations(session.orgId, "mensaje_nuevo_contacto", { customerId: result.customerId, conversationId: result.conversationId });
  }
  return result;
}
