/**
 * Mapa de navegación: qué ruta corresponde a qué recurso de la matriz.
 *
 * Código puro (sin React ni Next) para usarlo en el layout del servidor, en
 * el cliente y en las pruebas. Mostrar u ocultar un ítem es solo cosmético:
 * cada página vuelve a verificar el permiso con requireAccess().
 */
import { can, type PolicyOverrides, type Resource, type Role } from "../server/permissions/matrix.ts";

export type NavIcon =
  | "sun"
  | "chart"
  | "inbox"
  | "users"
  | "kanban"
  | "package"
  | "boxes"
  | "check"
  | "shield"
  | "settings";

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
  /** null = cualquier usuario autenticado. */
  resource: Resource | null;
  /** Fase del plan en la que el módulo queda operativo. */
  phase: number;
}

export const MAIN_NAV: readonly NavItem[] = [
  { href: "/mi-dia", label: "Mi día", icon: "sun", resource: "mi_dia", phase: 6 },
  { href: "/dashboard", label: "Dashboard", icon: "chart", resource: "dashboard", phase: 8 },
  { href: "/inbox", label: "Bandeja", icon: "inbox", resource: "inbox", phase: 3 },
  { href: "/clientes", label: "Clientes", icon: "users", resource: "clientes", phase: 2 },
  { href: "/pipeline", label: "Pipeline", icon: "kanban", resource: "pipeline", phase: 5 },
  { href: "/pedidos", label: "Pedidos", icon: "package", resource: "pedidos", phase: 5 },
  { href: "/productos", label: "Productos", icon: "boxes", resource: "productos", phase: 5 },
  { href: "/tareas", label: "Tareas", icon: "check", resource: "tareas", phase: 6 },
  { href: "/auditoria", label: "Auditoría", icon: "shield", resource: "auditoria", phase: 10 },
];

export interface ConfigSection {
  slug: string;
  label: string;
  description: string;
  resource: Resource | null;
  phase: number;
}

export const CONFIG_SECTIONS: readonly ConfigSection[] = [
  { slug: "general", label: "General", description: "País por defecto y horario de atención.", resource: "configuracion", phase: 2 },
  { slug: "empresa", label: "Empresa", description: "Nombre, zona horaria y moneda.", resource: "configuracion", phase: 2 },
  { slug: "usuarios", label: "Usuarios", description: "Altas, bajas y roles del equipo.", resource: "usuarios", phase: 2 },
  { slug: "roles", label: "Roles y permisos", description: "Qué puede hacer cada rol.", resource: "usuarios", phase: 2 },
  { slug: "equipos", label: "Equipos", description: "Equipos comerciales y supervisores.", resource: "equipos", phase: 2 },
  { slug: "zonas", label: "Zonas", description: "Zonas, localidades y vendedores que las cubren.", resource: "configuracion", phase: 4 },
  { slug: "asignacion", label: "Asignación", description: "Reglas automáticas y tiempo máximo de respuesta.", resource: "configuracion", phase: 4 },
  { slug: "whatsapp", label: "WhatsApp", description: "Conexión con WhatsApp Cloud API.", resource: "whatsapp_config", phase: 9 },
  { slug: "plantillas", label: "Plantillas", description: "Mensajes aprobados por Meta para escribir fuera de las 24 h.", resource: "plantillas", phase: 7 },
  { slug: "etiquetas", label: "Etiquetas", description: "Etiquetas con nombre y color para clientes y conversaciones.", resource: "etiquetas", phase: 3 },
  { slug: "automatizaciones", label: "Automatizaciones", description: "Reglas SI → ENTONCES que trabajan solas.", resource: "automatizaciones", phase: 7 },
  { slug: "notificaciones", label: "Notificaciones", description: "Qué avisos querés recibir (preferencia personal).", resource: null, phase: 6 },
  { slug: "integraciones", label: "Integraciones", description: "Conectores con otros sistemas.", resource: "integraciones", phase: 9 },
];

export const CONFIG_NAV: NavItem = {
  href: "/configuracion",
  label: "Configuración",
  icon: "settings",
  resource: null,
  phase: 1,
};

export function canSee(role: Role, resource: Resource | null, overrides?: PolicyOverrides): boolean {
  return resource === null || can(role, resource, "ver", overrides);
}

export function configSectionsFor(role: Role, overrides?: PolicyOverrides): ConfigSection[] {
  return CONFIG_SECTIONS.filter((s) => canSee(role, s.resource, overrides));
}

export function mainNavFor(role: Role, overrides?: PolicyOverrides): NavItem[] {
  const items = MAIN_NAV.filter((i) => canSee(role, i.resource, overrides));
  if (configSectionsFor(role, overrides).length > 0) items.push(CONFIG_NAV);
  return items;
}

/** Pantalla de inicio: el vendedor y el repartidor arrancan en "Mi día". */
export function landingFor(role: Role, overrides?: PolicyOverrides): string {
  const visible = mainNavFor(role, overrides);
  const prefersDay = role === "vendedor" || role === "repartidor";
  const preferred = prefersDay ? "/mi-dia" : "/dashboard";
  return visible.find((i) => i.href === preferred)?.href ?? visible[0]?.href ?? "/sin-acceso";
}

/** Cookie (no sensible) con la preferencia de menú colapsado. */
export const SIDEBAR_COOKIE = "sidebar-collapsed";
