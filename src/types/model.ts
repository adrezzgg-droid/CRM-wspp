/**
 * Modelo de datos (Firestore), multiempresa.
 *
 * Convención: TODO vive bajo `organizations/{orgId}/...`. Ninguna colección
 * de negocio existe en la raíz. Esto permite comercializar el CRM (un tenant
 * por cliente) y que las reglas de seguridad aíslen las organizaciones.
 *
 * Datos DEMO: viven en una organización propia con `isDemo: true`. El modo
 * demo nunca escribe en una organización real ni envía mensajes a Meta.
 *
 * Equivalencias con el listado de tablas del requerimiento:
 *   users, roles, permissions   -> members + settings/permissions
 *   customer_tags               -> customers.tagIds (array de ids)
 *   automation_actions          -> automations.actions (array embebido)
 *   message_attachments         -> messages.attachments (array embebido)
 *   pipeline_stages             -> pipelines/{id}.stages
 */

/**
 * Epoch ms (UTC), guardado tal cual en Firestore. Se eligió número y no
 * Firestore Timestamp para que los documentos viajen sin conversión de los
 * Server Components a los Client Components y se ordenen igual en todos lados.
 * Si hace falta TTL (p.ej. webhookEvents) se agrega un campo `expireAt` aparte.
 */
export type Timestamp = number;
export type Id = string;

export interface Audited {
  createdAt: Timestamp;
  createdBy: Id | "system" | "webhook";
  updatedAt: Timestamp;
  updatedBy: Id | "system" | "webhook";
}

export interface TenantScoped {
  orgId: Id;
  /** true => dato de demostración. Nunca se mezcla con datos reales. */
  isDemo: boolean;
}

// ───────────────────────── Organización y usuarios ─────────────────────────

export interface Organization extends Audited {
  id: Id;
  name: string;
  isDemo: boolean;
  plan: "free" | "pro" | "enterprise";
  timezone: string; // IANA, p.ej. America/Argentina/Cordoba
  currency: string; // ISO 4217
  status: "active" | "suspended";
}

export interface Member extends Audited, TenantScoped {
  id: Id; // = uid de Firebase Auth
  displayName: string;
  email: string;
  phone?: string;
  role: import("../server/permissions/matrix").Role;
  teamIds: Id[];
  zoneIds: Id[]; // un vendedor puede cubrir varias zonas
  active: boolean;
  /** Disponible para recibir asignación automática. */
  available: boolean;
  notificationPrefs: Partial<Record<NotificationType, boolean>>;
}

export interface Team extends Audited, TenantScoped {
  id: Id;
  name: string;
  leaderIds: Id[];
  memberIds: Id[];
}

export interface Zone extends Audited, TenantScoped {
  id: Id;
  name: string;
  localities: string[];
}

// ───────────────────────────── Clientes y leads ────────────────────────────

export type CustomerStage =
  | "prospecto"
  | "cliente_nuevo"
  | "cliente_activo"
  | "cliente_inactivo"
  | "cliente_perdido";

export interface Customer extends Audited, TenantScoped {
  id: Id;
  name: string;
  company?: string;
  phone?: string;
  whatsappId?: string; // wa_id normalizado (solo dígitos)
  email?: string;
  address?: string;
  neighborhood?: string;
  zoneId?: Id;
  locality?: string;
  customerType?: string;
  industry?: string; // rubro
  /**
   * Vendedor responsable. `null` (y no ausente) cuando no tiene: así se puede
   * consultar "sin asignar" con `where("ownerId", "==", null)`.
   */
  ownerId: Id | null;
  stage: CustomerStage;
  needsReactivation: boolean;
  tagIds: Id[];
  lastContactAt?: Timestamp;
  lastPurchaseAt?: Timestamp;
  /** Agregados desnormalizados, mantenidos por el servidor. */
  stats: { totalPurchased: number; ordersCount: number; avgTicket: number };
  /** Id del cliente en sistemas externos (p.ej. app de gestión). */
  externalRefs?: Record<string, string>;
  /** Baja lógica: el cliente y todo su historial se conservan. */
  archived: boolean;
  archivedAt?: Timestamp;
  /** Prefijos normalizados de nombre, empresa, teléfono, etc. (búsqueda). */
  searchKeywords: string[];
}

export const CUSTOMER_STAGE_LABELS: Record<CustomerStage, string> = {
  prospecto: "Prospecto",
  cliente_nuevo: "Cliente nuevo",
  cliente_activo: "Cliente activo",
  cliente_inactivo: "Cliente inactivo",
  cliente_perdido: "Cliente perdido",
};

/** `organizations/{orgId}/settings/general` */
export interface GeneralSettings {
  /** Código de país para normalizar teléfonos cargados sin prefijo (AR = "54"). */
  defaultCountryCode: string;
  /** Horario de atención; se usa para medir tiempos de respuesta. */
  businessHours: { days: number[]; from: string; to: string } | null;
  updatedAt: Timestamp;
  updatedBy: Id | "system";
}

export interface Contact extends Audited, TenantScoped {
  id: Id;
  customerId: Id;
  name: string;
  role?: string;
  phone?: string;
  email?: string;
}

export type LeadStatus =
  | "recibido"
  | "asignado"
  | "contactado"
  | "en_negociacion"
  | "pedido_generado"
  | "venta_realizada"
  | "cerrado"
  | "perdido";

export interface Lead extends Audited, TenantScoped {
  id: Id;
  customerId: Id;
  conversationId?: Id;
  source: "whatsapp" | "manual" | "import" | "api";
  status: LeadStatus;
  ownerId?: Id;
  firstResponseAt?: Timestamp;
  lostReason?: string;
}

// ─────────────────────────── Conversaciones y mensajes ─────────────────────

export type ConversationStatus =
  | "nueva"
  | "pendiente"
  | "en_atencion"
  | "cerrada";

export const CONVERSATION_STATUS_LABELS: Record<ConversationStatus, string> = {
  nueva: "Nueva",
  pendiente: "Pendiente",
  en_atencion: "En atención",
  cerrada: "Cerrada",
};

export type ConversationPriority = "baja" | "normal" | "alta" | "urgente";

/**
 * Una conversación por número de cliente y cuenta de WhatsApp: el id es
 * `${whatsappAccountId}_${waContactId}`, así un mensaje nuevo nunca duplica
 * la conversación. Cerrarla y que el cliente vuelva a escribir la reabre.
 */
export interface Conversation extends Audited, TenantScoped {
  id: Id;
  customerId: Id;
  whatsappAccountId: Id;
  waContactId: string;
  /** Nombre visible (perfil de WhatsApp o nombre del cliente), desnormalizado para la bandeja. */
  contactName: string;
  /** Etapa del cliente, desnormalizada para los filtros "Nuevos leads" y "Clientes". */
  customerStage: CustomerStage;
  status: ConversationStatus;
  priority: ConversationPriority;
  /** `null` (no ausente) cuando no tiene responsable: permite filtrar "sin asignar". */
  assigneeId: Id | null;
  teamId?: Id;
  tagIds: Id[];
  unreadCount: number;
  lastMessageAt?: Timestamp;
  lastMessagePreview?: string;
  lastMessageDirection?: "in" | "out" | "internal";
  lastInboundAt?: Timestamp;
  /** Fin de la ventana de 24 h de Meta (lastInboundAt + 24 h). */
  serviceWindowEndsAt?: Timestamp;
  awaitingReply: boolean;
  /** Primera respuesta del equipo (para medir tiempo de respuesta). */
  firstResponseAt?: Timestamp;
  closedAt?: Timestamp;
  leadId?: Id;
}

export type MessageType =
  | "text"
  | "image"
  | "document"
  | "audio"
  | "video"
  | "location"
  | "contacts"
  | "button_reply"
  | "list_reply"
  | "template"
  | "internal_note";

export interface MessageAttachment {
  storagePath?: string; // archivo copiado a Storage
  mediaId?: string; // media id de Meta
  mimeType: string;
  fileName?: string;
  size?: number;
  caption?: string;
}

export interface Message extends TenantScoped {
  id: Id; // = wamid de Meta para mensajes de WhatsApp (idempotencia)
  conversationId: Id;
  direction: "in" | "out" | "internal";
  type: MessageType;
  text?: string;
  attachments?: MessageAttachment[];
  location?: { lat: number; lng: number; name?: string; address?: string };
  interactive?: { id: string; title: string };
  /** Tarjetas de contacto compartidas por el cliente. */
  sharedContacts?: { name: string; phones: string[] }[];
  /** wamid del mensaje al que responde (si el cliente citó uno). */
  replyToId?: string;
  templateName?: string;
  senderId?: Id | "system" | "customer";
  status?: "queued" | "sent" | "delivered" | "read" | "failed";
  errorCode?: string;
  timestamp: Timestamp;
  createdAt: Timestamp;
}

export interface Assignment extends TenantScoped {
  id: Id;
  conversationId: Id;
  fromId?: Id;
  toId?: Id;
  toTeamId?: Id;
  reason: "manual" | "regla_nuevo" | "regla_zona" | "cliente_existente" | "reasignacion";
  byId: Id | "system";
  at: Timestamp;
}

// ───────────────────────────── Pipeline y ventas ───────────────────────────

export interface PipelineStage {
  id: Id;
  name: string;
  order: number;
  probability: number; // 0..100
  kind: "abierta" | "ganada" | "perdida";
}

export interface Pipeline extends Audited, TenantScoped {
  id: Id;
  name: string;
  stages: PipelineStage[];
}

export interface Opportunity extends Audited, TenantScoped {
  id: Id;
  customerId: Id;
  leadId?: Id;
  ownerId: Id;
  pipelineId: Id;
  stageId: Id;
  estimatedValue: number;
  product?: string;
  expectedCloseAt?: Timestamp;
  probability: number;
  nextAction?: string;
  notes?: string;
}

export interface OrderItem {
  productId: Id;
  name: string;
  qty: number;
  unitPrice: number;
}

export type OrderStatus =
  | "borrador"
  | "confirmado"
  | "en_preparacion"
  | "en_reparto"
  | "entregado"
  | "cancelado";

/**
 * Pedido: eslabón entre el CRM y el sistema de gestión/reparto.
 * Trazabilidad: conversationId -> leadId -> opportunityId -> orderId -> deliveryRef.
 */
export interface Order extends Audited, TenantScoped {
  id: Id;
  number: string; // legible, correlativo por organización
  customerId: Id;
  sellerId: Id;
  /** Repartidor asignado. Es lo que habilita al rol repartidor a ver el pedido. */
  driverId?: Id;
  conversationId?: Id;
  leadId?: Id;
  opportunityId?: Id;
  items: OrderItem[];
  total: number;
  status: OrderStatus;
  deliveryRef?: { system: string; externalId: string; status?: string };
}

export interface Product extends Audited, TenantScoped {
  id: Id;
  sku?: string;
  name: string;
  unit: string;
  price: number;
  active: boolean;
  externalRefs?: Record<string, string>;
}

// ───────────────────────── Tareas, notas, actividad ────────────────────────

export interface Task extends Audited, TenantScoped {
  id: Id;
  customerId?: Id;
  conversationId?: Id;
  assigneeId: Id;
  type: "llamada" | "whatsapp" | "visita" | "seguimiento" | "cotizacion" | "postventa";
  priority: "baja" | "normal" | "alta";
  status: "pendiente" | "completada" | "cancelada";
  dueAt: Timestamp;
  description?: string;
  completedAt?: Timestamp;
}

export interface Note extends Audited, TenantScoped {
  id: Id;
  customerId?: Id;
  conversationId?: Id;
  text: string;
}

export interface Tag extends Audited, TenantScoped {
  id: Id;
  name: string;
  color: string; // hex
}

/** Línea de tiempo de negocio. Solo se inserta; nunca se edita ni se borra. */
export interface Activity extends TenantScoped {
  id: Id;
  at: Timestamp;
  kind: string; // p.ej. "lead.recibido", "conversacion.asignada", "pedido.creado"
  customerId?: Id;
  conversationId?: Id;
  leadId?: Id;
  orderId?: Id;
  actorId: Id | "system" | "webhook" | "customer";
  summary: string;
  data?: Record<string, unknown>;
}

/** Auditoría de seguridad/configuración. Solo inserción; guarda antes y después. */
export interface AuditLog extends TenantScoped {
  id: Id;
  at: Timestamp;
  actorId: Id | "system";
  action: string; // p.ej. "member.role_changed"
  target: { collection: string; id: Id };
  before?: unknown;
  after?: unknown;
  ip?: string;
}

// ─────────────────────────── WhatsApp y automatización ─────────────────────

/**
 * Datos públicos de la cuenta de WhatsApp. El Access Token NO está aquí:
 * se guarda cifrado en `organizations/{orgId}/secrets/whatsapp`, colección
 * con reglas `allow read, write: if false` (solo Admin SDK desde el servidor).
 */
export interface WhatsappAccount extends Audited, TenantScoped {
  id: Id;
  displayPhone: string;
  phoneNumberId: string;
  wabaId: string;
  verifyTokenSet: boolean;
  tokenSet: boolean;
  connectionStatus: "sin_configurar" | "conectado" | "error";
  webhookStatus: "sin_verificar" | "verificado" | "error";
  lastSyncAt?: Timestamp;
}

export type TemplateCategory = "marketing" | "utility" | "authentication";

export interface WhatsappTemplate extends Audited, TenantScoped {
  id: Id;
  name: string;
  category: TemplateCategory;
  language: string;
  body: string;
  variables: string[]; // p.ej. ["nombre", "pedido"]
  metaStatus: "borrador" | "pendiente" | "aprobada" | "rechazada";
  metaTemplateId?: string;
}

export type AutomationTrigger =
  | "mensaje_nuevo_contacto"
  | "sin_respuesta_cliente"
  | "sin_respuesta_vendedor"
  | "pedido_creado"
  | "sin_compra_dias";

export interface AutomationAction {
  type:
    | "crear_lead"
    | "asignar_vendedor"
    | "agregar_etiqueta"
    | "enviar_mensaje"
    | "crear_tarea"
    | "cambiar_estado_cliente"
    | "marcar_reactivar"
    | "notificar";
  params: Record<string, unknown>;
}

export interface Automation extends Audited, TenantScoped {
  id: Id;
  name: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  conditions: Record<string, unknown>;
  delayMinutes?: number;
  actions: AutomationAction[];
}

export type NotificationType =
  | "nuevo_lead"
  | "nuevo_mensaje"
  | "lead_sin_responder"
  | "tarea_vencida"
  | "cliente_esperando"
  | "nueva_asignacion"
  | "pedido_generado"
  | "cliente_reactivar";

export interface Notification extends TenantScoped {
  id: Id;
  userId: Id;
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
  read: boolean;
  createdAt: Timestamp;
}

// ─────────────────────────────── Conectores ────────────────────────────────

/** Cola de salida hacia sistemas externos (p.ej. app de gestión). */
export interface OutboxItem extends TenantScoped {
  id: Id;
  connector: string; // "gestion", "google_sheets", ...
  event: string; // "order.created"
  payload: Record<string, unknown>;
  status: "pendiente" | "enviado" | "error";
  attempts: number;
  nextAttemptAt?: Timestamp;
  lastError?: string;
  createdAt: Timestamp;
}

/** Evento crudo recibido de Meta (para idempotencia y reproceso). */
export interface WebhookEvent {
  id: Id;
  orgId?: Id;
  source: "whatsapp";
  receivedAt: Timestamp;
  processedAt?: Timestamp;
  status: "recibido" | "procesado" | "error";
  error?: string;
  payload: unknown;
}

// ────────────────────────────── Rutas de colecciones ───────────────────────

export const COLLECTIONS = {
  organizations: "organizations",
  members: "members",
  teams: "teams",
  zones: "zones",
  customers: "customers",
  contacts: "contacts",
  leads: "leads",
  conversations: "conversations",
  messages: "messages", // subcolección de conversations
  assignments: "assignments",
  pipelines: "pipelines",
  opportunities: "opportunities",
  orders: "orders",
  products: "products",
  tasks: "tasks",
  notes: "notes",
  tags: "tags",
  activities: "activities",
  auditLogs: "auditLogs",
  whatsappAccounts: "whatsappAccounts",
  whatsappTemplates: "whatsappTemplates",
  automations: "automations",
  notifications: "notifications",
  outbox: "outbox",
  secrets: "secrets",
  settings: "settings",
} as const;

export const orgPath = (orgId: Id, collection: keyof typeof COLLECTIONS) =>
  `${COLLECTIONS.organizations}/${orgId}/${COLLECTIONS[collection]}`;
