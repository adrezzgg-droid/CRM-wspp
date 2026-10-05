/**
 * Esquemas de validación de entrada (zod). El servidor los aplica siempre;
 * los formularios los usan para tipar y mostrar errores por campo.
 */
import { z } from "zod";
import { ACTIONS, RESOURCES, ROLES } from "../server/permissions/matrix.ts";

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
