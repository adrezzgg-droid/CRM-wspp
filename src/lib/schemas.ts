/**
 * Esquemas de validación de entrada (zod). El servidor los aplica siempre;
 * los formularios los usan para tipar y mostrar errores por campo.
 */
import { z } from "zod";
import { ACTIONS, RESOURCES, ROLES } from "../server/permissions/matrix.ts";
import { unknownVariables } from "./templates.ts";

const text = (max: number, label: string) =>
  z.string().trim().max(max, `${label}: máximo ${max} caracteres`);

const optionalText = (max: number, label: string) =>
  text(max, label).transform((v) => v || undefined).optional();

const id = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/, "Identificador inválido");

export const CUSTOMER_STAGES = [
  "prospecto",
  "cliente_nuevo",
  "cliente_activo",
  "cliente_inactivo",
  "cliente_perdido",
] as const;

// ─────────────────────────────── Clientes ───────────────────────────────────

/** Campos sin valores por defecto (para que una edición parcial no pise nada). */
const customerFields = z.object({
  name: text(120, "Nombre").min(2, "El nombre es obligatorio"),
  company: optionalText(120, "Empresa"),
  phone: optionalText(40, "Teléfono"),
  /** WhatsApp en cualquier formato; el servidor lo normaliza. Vacío = usar el teléfono. */
  whatsapp: optionalText(40, "WhatsApp"),
  email: z
    .string()
    .trim()
    .max(160)
    .transform((v) => v.toLowerCase() || undefined)
    .pipe(z.email("Email inválido").optional())
    .optional(),
  address: optionalText(200, "Dirección"),
  neighborhood: optionalText(80, "Barrio"),
  zoneId: id.optional().or(z.literal("").transform(() => undefined)),
  locality: optionalText(80, "Localidad"),
  customerType: optionalText(60, "Tipo de cliente"),
  industry: optionalText(60, "Rubro"),
  ownerId: id.nullable().optional(),
  stage: z.enum(CUSTOMER_STAGES),
  needsReactivation: z.boolean(),
  tagIds: z.array(id).max(20, "Máximo 20 etiquetas"),
});

export const customerInput = customerFields.extend({
  stage: customerFields.shape.stage.default("prospecto"),
  needsReactivation: customerFields.shape.needsReactivation.default(false),
  tagIds: customerFields.shape.tagIds.default([]),
  note: optionalText(2000, "Nota"),
});
export type CustomerInput = z.input<typeof customerInput>;

/** Solo las claves enviadas cambian; un texto vacío borra el campo. */
export const customerUpdate = customerFields.partial();
export type CustomerUpdate = z.input<typeof customerUpdate>;

export const archiveInput = z.object({ archived: z.boolean() });

export const noteInput = z.object({
  text: text(4000, "Nota").min(1, "La nota está vacía"),
});

export const contactInput = z.object({
  name: text(120, "Nombre").min(2, "El nombre es obligatorio"),
  role: optionalText(80, "Cargo"),
  phone: optionalText(40, "Teléfono"),
  email: z
    .string()
    .trim()
    .max(160)
    .transform((v) => v.toLowerCase() || undefined)
    .pipe(z.email("Email inválido").optional())
    .optional(),
});

export const customerListQuery = z.object({
  q: z.string().trim().max(80).optional(),
  stage: z.enum(CUSTOMER_STAGES).optional(),
  /** uid del responsable o "none" para "sin asignar". */
  owner: z.string().trim().max(128).optional(),
  zone: id.optional(),
  tag: id.optional(),
  reactivar: z.enum(["1"]).optional(),
  archivados: z.enum(["1"]).optional(),
  cursor: id.optional(),
});
export type CustomerListQuery = z.infer<typeof customerListQuery>;

// ─────────────────────────────── Usuarios ───────────────────────────────────

export const memberCreate = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Email inválido")),
  displayName: text(80, "Nombre").min(2, "El nombre es obligatorio"),
  phone: optionalText(40, "Teléfono"),
  role: z.enum(ROLES),
  teamIds: z.array(id).max(20).default([]),
  zoneIds: z.array(id).max(50).default([]),
});

export const memberUpdate = z
  .object({
    displayName: text(80, "Nombre").min(2, "El nombre es obligatorio"),
    phone: optionalText(40, "Teléfono"),
    role: z.enum(ROLES),
    teamIds: z.array(id).max(20),
    zoneIds: z.array(id).max(50),
    available: z.boolean(),
  })
  .partial();

export const memberStatus = z.object({ active: z.boolean() });

// ─────────────────────────────── Equipos ────────────────────────────────────

export const teamInput = z.object({
  name: text(80, "Nombre").min(2, "El nombre es obligatorio"),
  leaderIds: z.array(id).max(10).default([]),
  memberIds: z.array(id).max(200).default([]),
});

// ─────────────────────────── Roles y permisos ───────────────────────────────

const grant = z.object({
  actions: z.array(z.enum(ACTIONS)).max(ACTIONS.length),
  scope: z.enum(["todo", "equipo", "propio"]),
});
const rolePolicy = z.partialRecord(z.enum(RESOURCES), grant);

/** El admin no se puede configurar: nunca se degrada. */
export const permissionsInput = z.object({
  overrides: z.partialRecord(z.enum(["supervisor", "vendedor", "repartidor", "solo_lectura"]), rolePolicy),
});

// ─────────────────────────────── Empresa ────────────────────────────────────

export const organizationUpdate = z.object({
  name: text(120, "Nombre").min(2, "El nombre es obligatorio"),
  timezone: z.string().refine((tz) => {
    try {
      new Intl.DateTimeFormat("es-AR", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "Zona horaria inválida"),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Moneda inválida (código de 3 letras)"),
});

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora inválida (HH:MM)");

export const generalSettingsInput = z.object({
  defaultCountryCode: z.string().regex(/^[1-9]\d{0,2}$/, "Código de país inválido"),
  businessHours: z
    .object({
      days: z.array(z.number().int().min(0).max(6)).min(1, "Elegí al menos un día"),
      from: hhmm,
      to: hhmm,
    })
    .refine((h) => h.from < h.to, "El horario de cierre tiene que ser posterior al de apertura")
    .nullable(),
});

// ─────────────────────────────── Bandeja ────────────────────────────────────

export const CONVERSATION_STATUSES = ["nueva", "pendiente", "en_atencion", "cerrada"] as const;
export const CONVERSATION_PRIORITIES = ["baja", "normal", "alta", "urgente"] as const;

export const messageInput = z.object({
  text: text(4096, "Mensaje").min(1, "El mensaje está vacío"),
  /** true = nota interna: no se envía al cliente. */
  note: z.boolean().default(false),
});

export const conversationUpdate = z
  .object({
    // "nueva" la pone solo el sistema.
    status: z.enum(["pendiente", "en_atencion", "cerrada"]),
    priority: z.enum(CONVERSATION_PRIORITIES),
    tagIds: z.array(id).max(20, "Máximo 20 etiquetas"),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "No hay cambios");

/** Asignar a una persona y/o a un equipo (null = quitar). */
export const assignInput = z
  .object({ assigneeId: id.nullable(), teamId: id.nullable() })
  .partial()
  .refine((v) => v.assigneeId !== undefined || v.teamId !== undefined, "Indicá a quién o a qué equipo asignar");

/** Simulador del modo demo: un mensaje entrante como si llegara de WhatsApp. */
export const DEMO_INBOUND_TYPES = ["text", "image", "document", "audio", "video", "location", "contacts", "button_reply", "list_reply"] as const;
export const demoInboundInput = z.object({
  phone: text(40, "Teléfono").min(6, "Ingresá un número"),
  name: optionalText(80, "Nombre"),
  type: z.enum(DEMO_INBOUND_TYPES).default("text"),
  text: optionalText(4096, "Texto"),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  placeName: optionalText(120, "Lugar"),
});

// ─────────────────────────────── Etiquetas ──────────────────────────────────

export const tagInput = z.object({
  name: text(40, "Nombre").min(1, "El nombre es obligatorio").transform((v) => v.toUpperCase()),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color inválido"),
});

// ───────────────────────── Asignación y leads ───────────────────────────────

export const LEAD_STATUSES = ["recibido", "asignado", "contactado", "en_negociacion", "pedido_generado", "venta_realizada", "cerrado", "perdido"] as const;

export const leadStatusInput = z
  .object({
    status: z.enum(LEAD_STATUSES),
    lostReason: optionalText(200, "Motivo"),
  })
  .refine((v) => v.status !== "perdido" || !!v.lostReason, { message: "Indicá el motivo de la pérdida", path: ["lostReason"] });

export const assignmentSettingsInput = z.object({
  autoAssign: z.boolean(),
  useZones: z.boolean(),
  zoneFallback: z.boolean(),
  slaEnabled: z.boolean(),
  slaMinutes: z.coerce.number().int().min(1, "Mínimo 1 minuto").max(1440, "Máximo 24 h"),
});

export const zoneInput = z.object({
  name: text(60, "Nombre").min(2, "El nombre es obligatorio"),
  localities: z.array(text(80, "Localidad").min(1)).max(100).default([]),
  /** Vendedores que cubren la zona (se guarda en member.zoneIds). */
  sellerIds: z.array(id).max(100).default([]),
});

export const availabilityInput = z.object({ available: z.boolean() });

// ───────────────────────────── Pipeline ─────────────────────────────────────

const money = z.coerce.number().min(0, "No puede ser negativo").max(1_000_000_000, "Importe demasiado alto");
const dateMs = z.coerce.number().int().min(0).max(4_102_444_800_000);

const opportunityFields = z.object({
  customerId: id,
  ownerId: id,
  stageId: id,
  estimatedValue: money,
  product: optionalText(120, "Producto"),
  expectedCloseAt: dateMs.nullable(),
  probability: z.coerce.number().int().min(0).max(100),
  nextAction: optionalText(200, "Próxima acción"),
  notes: optionalText(2000, "Notas"),
  lostReason: optionalText(200, "Motivo"),
  conversationId: id,
  leadId: id,
});

/** Alta: cliente obligatorio; el resto tiene valores por defecto. */
export const opportunityInput = opportunityFields.partial().extend({
  customerId: id,
  estimatedValue: money.default(0),
});

/** Edición y movimiento de etapa (arrastrar en el tablero). */
export const opportunityUpdate = opportunityFields.omit({ customerId: true, conversationId: true, leadId: true }).partial();

// ───────────────────────────── Productos ────────────────────────────────────

export const productInput = z.object({
  name: text(120, "Nombre").min(2, "El nombre es obligatorio"),
  sku: optionalText(40, "Código"),
  unit: text(20, "Unidad").min(1, "Indicá la unidad (kg, unidad, caja…)"),
  price: money,
  active: z.boolean().default(true),
});

export const productListQuery = z.object({
  q: z.string().trim().max(80).optional(),
  inactivos: z.enum(["1"]).optional(),
});

// ───────────────────────────── Pedidos ──────────────────────────────────────

export const ORDER_STATUSES = ["borrador", "confirmado", "en_preparacion", "en_reparto", "entregado", "cancelado"] as const;

export const orderItemInput = z.object({
  productId: id,
  qty: z.coerce.number().positive("La cantidad tiene que ser mayor a 0").max(100_000),
  /** Si no viene, se usa el precio de lista del producto. */
  unitPrice: money.optional(),
});

export const orderInput = z.object({
  customerId: id,
  items: z.array(orderItemInput).min(1, "Agregá al menos un producto").max(100),
  notes: optionalText(1000, "Notas"),
  deliveryAddress: optionalText(200, "Dirección de entrega"),
  deliveryDate: dateMs.optional(),
  conversationId: id.optional(),
  leadId: id.optional(),
  opportunityId: id.optional(),
  /** true = se crea confirmado (si no, queda en borrador). */
  confirm: z.boolean().default(false),
});

export const orderStatusInput = z
  .object({
    status: z.enum(ORDER_STATUSES),
    reason: optionalText(200, "Motivo"),
  })
  .refine((v) => v.status !== "cancelado" || !!v.reason, { message: "Indicá el motivo de la cancelación", path: ["reason"] });

export const orderDriverInput = z.object({ driverId: id.nullable() });

export const orderListQuery = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  vendedor: id.optional(),
  repartidor: id.optional(),
  cursor: id.optional(),
});
export type OrderListQuery = z.infer<typeof orderListQuery>;

// ─────────────────────────────── Tareas ─────────────────────────────────────

export const TASK_TYPES = ["llamada", "whatsapp", "visita", "seguimiento", "cotizacion", "postventa"] as const;
export const TASK_PRIORITIES = ["baja", "normal", "alta"] as const;
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida");
const hm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora inválida");

const taskFields = z.object({
  type: z.enum(TASK_TYPES),
  priority: z.enum(TASK_PRIORITIES),
  /** Fecha y hora en la zona horaria de la empresa. */
  dueDate: ymd,
  dueTime: hm,
  description: optionalText(1000, "Descripción"),
  assigneeId: id,
  customerId: id.nullable(),
});

export const taskInput = taskFields.extend({
  priority: taskFields.shape.priority.default("normal"),
  dueTime: taskFields.shape.dueTime.default("09:00"),
  assigneeId: id.optional(),
  customerId: id.optional(),
  conversationId: id.optional(),
  opportunityId: id.optional(),
});

export const taskUpdate = taskFields.partial();

export const taskStatusInput = z.object({
  status: z.enum(["pendiente", "completada", "cancelada"]),
  /** Resultado: qué se habló o acordó (al completar). */
  outcome: optionalText(1000, "Resultado"),
});

export const taskListQuery = z.object({
  vista: z.enum(["hoy", "vencidas", "proximas", "completadas"]).default("hoy"),
  responsable: id.optional(),
});

// ─────────────────────────── Notificaciones ─────────────────────────────────

export const NOTIFICATION_TYPES = [
  "nuevo_lead",
  "nuevo_mensaje",
  "lead_sin_responder",
  "tarea_vencida",
  "cliente_esperando",
  "nueva_asignacion",
  "pedido_generado",
  "cliente_reactivar",
  "automatizacion",
] as const;

export const notificationPrefsInput = z.object({
  prefs: z.partialRecord(z.enum(NOTIFICATION_TYPES), z.boolean()),
});

// ───────────────────────────── Plantillas ───────────────────────────────────

export const TEMPLATE_CATEGORIES = ["marketing", "utility", "authentication"] as const;
export const META_STATUSES = ["borrador", "pendiente", "aprobada", "rechazada"] as const;

export const templateInput = z.object({
  /** Nombre técnico para Meta: minúsculas, números y guion bajo. */
  name: z.string().trim().regex(/^[a-z0-9_]{1,60}$/, "Solo minúsculas, números y guion bajo (ej.: confirmacion_pedido)"),
  category: z.enum(TEMPLATE_CATEGORIES),
  language: z.string().trim().regex(/^[a-z]{2}(_[A-Z]{2})?$/, "Código de idioma inválido (ej.: es_AR)").default("es_AR"),
  body: text(1024, "Mensaje")
    .min(1, "El mensaje está vacío")
    .refine((b) => unknownVariables(b).length === 0, "Hay variables desconocidas. Usá {{nombre}}, {{empresa}}, {{vendedor}}, {{pedido}}, {{fecha}} o {{importe}}."),
});

export const templateStatusInput = z.object({ metaStatus: z.enum(META_STATUSES) });

export const sendTemplateInput = z.object({
  templateId: id,
  /** Valores de las variables (los completa el formulario con datos del cliente). */
  values: z.record(z.string(), z.string().trim().max(500)),
});

// ─────────────────────────── Automatizaciones ───────────────────────────────

export const AUTOMATION_TRIGGERS = ["mensaje_nuevo_contacto", "sin_respuesta_cliente", "pedido_creado", "sin_compra_dias"] as const;

export const automationActionInput = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("enviar_mensaje"), templateId: id.optional(), text: optionalText(1024, "Mensaje") })
    .refine((a) => !!a.templateId || !!a.text, "Elegí una plantilla o escribí el mensaje"),
  z.object({ type: z.literal("agregar_etiqueta"), tagId: id }),
  z.object({
    type: z.literal("crear_tarea"),
    taskType: z.enum(TASK_TYPES),
    dueInHours: z.coerce.number().int().min(0).max(720),
    description: optionalText(500, "Descripción"),
  }),
  z.object({ type: z.literal("cambiar_estado_cliente"), stage: z.enum(CUSTOMER_STAGES) }),
  z.object({ type: z.literal("marcar_reactivar") }),
  z.object({
    type: z.literal("notificar"),
    to: z.enum(["responsable", "supervisores", "administradores"]),
    message: text(200, "Aviso").min(1, "Escribí el aviso"),
  }),
]);

export const automationInput = z
  .object({
    name: text(80, "Nombre").min(2, "El nombre es obligatorio"),
    enabled: z.boolean().default(true),
    trigger: z.enum(AUTOMATION_TRIGGERS),
    triggerParams: z
      .object({
        hours: z.coerce.number().int().min(1).max(720).optional(),
        days: z.coerce.number().int().min(1).max(365).optional(),
      })
      .default({}),
    conditions: z
      .object({
        stages: z.array(z.enum(CUSTOMER_STAGES)).max(5).optional(),
        zoneIds: z.array(id).max(50).optional(),
      })
      .default({}),
    delayMinutes: z.coerce.number().int().min(0).max(10_080).default(0),
    actions: z.array(automationActionInput).min(1, "Agregá al menos una acción").max(10),
  })
  .refine((a) => a.trigger !== "sin_respuesta_cliente" || !!a.triggerParams.hours, { message: "Indicá las horas", path: ["triggerParams"] })
  .refine((a) => a.trigger !== "sin_compra_dias" || !!a.triggerParams.days, { message: "Indicá los días", path: ["triggerParams"] })
  .refine((a) => a.delayMinutes === 0 || a.trigger === "mensaje_nuevo_contacto" || a.trigger === "pedido_creado", { message: "La demora solo aplica a reglas de evento", path: ["delayMinutes"] });

export const automationToggleInput = z.object({ enabled: z.boolean() });
