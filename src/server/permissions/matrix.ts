/**
 * Matriz de permisos del CRM.
 *
 * Es código puro (sin dependencias) para poder usarse igual en el servidor,
 * en el cliente (ocultar menús) y en las pruebas. La fuente de verdad de la
 * autorización es SIEMPRE el servidor y firestore.rules; el cliente solo la
 * usa para decidir qué mostrar.
 */

export const ROLES = [
  "admin",
  "supervisor",
  "vendedor",
  "repartidor",
  "solo_lectura",
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Administrador",
  supervisor: "Supervisor",
  vendedor: "Vendedor",
  repartidor: "Repartidor",
  solo_lectura: "Solo lectura",
};

/** Recursos del sistema sobre los que se puede actuar. */
export const RESOURCES = [
  "dashboard",
  "mi_dia",
  "inbox",
  "clientes",
  "pipeline",
  "pedidos",
  "productos",
  "tareas",
  "usuarios",
  "equipos",
  "etiquetas",
  "plantillas",
  "automatizaciones",
  "whatsapp_config",
  "integraciones",
  "configuracion",
  "auditoria",
] as const;
export type Resource = (typeof RESOURCES)[number];

export const ACTIONS = ["ver", "crear", "editar", "eliminar", "asignar"] as const;
export type Action = (typeof ACTIONS)[number];

/**
 * Alcance de visibilidad de un permiso:
 *  - "todo":   toda la organización
 *  - "equipo": los equipos que lidera/integra el usuario
 *  - "propio": solo lo asignado al usuario
 */
export type Scope = "todo" | "equipo" | "propio";

export interface Grant {
  actions: readonly Action[];
  scope: Scope;
}

type RolePolicy = Partial<Record<Resource, Grant>>;

const ALL: readonly Action[] = ["ver", "crear", "editar", "eliminar", "asignar"];
const READ: readonly Action[] = ["ver"];
const RW: readonly Action[] = ["ver", "crear", "editar"];

export const DEFAULT_POLICY: Record<Role, RolePolicy> = {
  admin: Object.fromEntries(
    RESOURCES.map((r) => [r, { actions: ALL, scope: "todo" } satisfies Grant]),
  ) as RolePolicy,

  supervisor: {
    dashboard: { actions: READ, scope: "equipo" },
    mi_dia: { actions: READ, scope: "propio" },
    inbox: { actions: ["ver", "editar", "asignar"], scope: "equipo" },
    clientes: { actions: RW, scope: "equipo" },
    pipeline: { actions: RW, scope: "equipo" },
    pedidos: { actions: RW, scope: "equipo" },
    productos: { actions: READ, scope: "todo" },
    tareas: { actions: ["ver", "crear", "editar", "asignar"], scope: "equipo" },
    equipos: { actions: READ, scope: "equipo" },
    etiquetas: { actions: READ, scope: "todo" },
    plantillas: { actions: READ, scope: "todo" },
  },

  vendedor: {
    mi_dia: { actions: READ, scope: "propio" },
    inbox: { actions: ["ver", "editar"], scope: "propio" },
    clientes: { actions: RW, scope: "propio" },
    pipeline: { actions: RW, scope: "propio" },
    pedidos: { actions: RW, scope: "propio" },
    productos: { actions: READ, scope: "todo" },
    tareas: { actions: RW, scope: "propio" },
    etiquetas: { actions: READ, scope: "todo" },
    plantillas: { actions: READ, scope: "todo" },
  },

  repartidor: {
    mi_dia: { actions: READ, scope: "propio" },
    pedidos: { actions: ["ver", "editar"], scope: "propio" },
    tareas: { actions: ["ver", "editar"], scope: "propio" },
  },

  solo_lectura: {
    dashboard: { actions: READ, scope: "todo" },
    inbox: { actions: READ, scope: "todo" },
    clientes: { actions: READ, scope: "todo" },
    pipeline: { actions: READ, scope: "todo" },
    pedidos: { actions: READ, scope: "todo" },
    productos: { actions: READ, scope: "todo" },
    tareas: { actions: READ, scope: "todo" },
  },
};

/**
 * Overrides por organización: permite "permisos configurables" sin tocar
 * código. Se guardan en `organizations/{orgId}/settings/permissions`.
 */
export type PolicyOverrides = Partial<Record<Role, RolePolicy>>;

export function resolvePolicy(
  role: Role,
  overrides?: PolicyOverrides,
): RolePolicy {
  // El administrador nunca puede ser degradado: evita que una organización
  // se quede sin nadie capaz de corregir la configuración.
  if (role === "admin") return DEFAULT_POLICY.admin;
  return { ...DEFAULT_POLICY[role], ...(overrides?.[role] ?? {}) };
}

export function can(
  role: Role,
  resource: Resource,
  action: Action,
  overrides?: PolicyOverrides,
): boolean {
  const grant = resolvePolicy(role, overrides)[resource];
  return !!grant && grant.actions.includes(action);
}

export function scopeOf(
  role: Role,
  resource: Resource,
  overrides?: PolicyOverrides,
): Scope | null {
  return resolvePolicy(role, overrides)[resource]?.scope ?? null;
}

export function visibleResources(
  role: Role,
  overrides?: PolicyOverrides,
): Resource[] {
  return RESOURCES.filter((r) => can(role, r, "ver", overrides));
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}
