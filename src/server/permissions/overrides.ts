/**
 * Conversión entre la política completa de un rol (lo que se edita en pantalla)
 * y los overrides que se guardan (solo lo que difiere del default). Código puro.
 */
import {
  ACTIONS,
  DEFAULT_POLICY,
  RESOURCES,
  type Action,
  type Grant,
  type PolicyOverrides,
  type Resource,
  type Role,
  type Scope,
} from "./matrix.ts";

export type EditableRole = Exclude<Role, "admin">;
export const EDITABLE_ROLES: readonly EditableRole[] = ["supervisor", "vendedor", "repartidor", "solo_lectura"];

export type FullPolicy = Record<Resource, { actions: Action[]; scope: Scope }>;

function normalize(g: Grant | undefined): { actions: Action[]; scope: Scope } {
  return {
    actions: ACTIONS.filter((a) => g?.actions.includes(a)),
    scope: g?.scope ?? "propio",
  };
}

function sameGrant(a: Grant | undefined, b: { actions: Action[]; scope: Scope }): boolean {
  const na = normalize(a);
  if (na.actions.length === 0 && b.actions.length === 0) return true;
  return na.scope === b.scope && na.actions.join() === b.actions.join();
}

/** Política completa (todos los recursos) aplicando los overrides. */
export function fullPolicy(role: Role, overrides?: PolicyOverrides): FullPolicy {
  const base = role === "admin" ? DEFAULT_POLICY.admin : { ...DEFAULT_POLICY[role], ...(overrides?.[role] ?? {}) };
  return Object.fromEntries(RESOURCES.map((r) => [r, normalize(base[r])])) as FullPolicy;
}

/** Overrides mínimos para que el rol quede con `policy`. */
export function overridesFor(role: EditableRole, policy: FullPolicy): Partial<Record<Resource, Grant>> {
  const out: Partial<Record<Resource, Grant>> = {};
  for (const r of RESOURCES) {
    const wanted = normalize(policy[r]);
    if (!sameGrant(DEFAULT_POLICY[role][r], wanted)) out[r] = wanted;
  }
  return out;
}

export const RESOURCE_LABELS: Record<Resource, string> = {
  dashboard: "Dashboard",
  mi_dia: "Mi día",
  inbox: "Bandeja",
  clientes: "Clientes",
  pipeline: "Pipeline",
  pedidos: "Pedidos",
  productos: "Productos",
  tareas: "Tareas",
  usuarios: "Usuarios",
  equipos: "Equipos",
  etiquetas: "Etiquetas",
  plantillas: "Plantillas",
  automatizaciones: "Automatizaciones",
  whatsapp_config: "WhatsApp",
  integraciones: "Integraciones",
  configuracion: "Configuración",
  auditoria: "Auditoría",
};

export const ACTION_LABELS: Record<Action, string> = {
  ver: "Ver",
  crear: "Crear",
  editar: "Editar",
  eliminar: "Eliminar",
  asignar: "Asignar",
};

export const SCOPE_LABELS: Record<Scope, string> = {
  todo: "Toda la empresa",
  equipo: "Su equipo",
  propio: "Lo propio",
};
