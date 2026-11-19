/**
 * Nombres legibles y categorías de la auditoría (Configuración y seguridad).
 * Código puro: lo usan la pantalla, la exportación y las pruebas.
 */

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  "auth.login": "Inició sesión",
  "auth.logout": "Cerró sesión",
  "member.created": "Alta de usuario",
  "member.updated": "Modificó un usuario",
  "member.role_changed": "Cambió el rol de un usuario",
  "member.deactivated": "Dio de baja a un usuario",
  "member.reactivated": "Reactivó a un usuario",
  "member.availability": "Cambió su disponibilidad",
  "team.created": "Creó un equipo",
  "team.updated": "Modificó un equipo",
  "team.deleted": "Eliminó un equipo",
  "permissions.updated": "Cambió los permisos por rol",
  "org.created": "Creó la empresa",
  "organization.updated": "Modificó los datos de la empresa",
  "settings.general_updated": "Cambió la configuración general",
  "settings.assignment_updated": "Cambió las reglas de asignación",
  "zone.created": "Creó una zona",
  "zone.updated": "Modificó una zona",
  "zone.deleted": "Eliminó una zona",
  "tag.created": "Creó una etiqueta",
  "tag.updated": "Modificó una etiqueta",
  "tag.deleted": "Eliminó una etiqueta",
  "product.created": "Cargó un producto",
  "product.updated": "Modificó un producto",
  "whatsapp.connected": "Conectó WhatsApp",
  "whatsapp.updated": "Actualizó la conexión de WhatsApp",
  "whatsapp.disconnected": "Desconectó WhatsApp",
  "template.created": "Creó una plantilla",
  "template.updated": "Modificó una plantilla",
  "template.deleted": "Eliminó una plantilla",
  "template.submitted": "Envió una plantilla a Meta",
  "template.status": "Cambió el estado de una plantilla",
  "template.synced": "Sincronizó las plantillas con Meta",
  "automation.created": "Creó una automatización",
  "automation.updated": "Modificó una automatización",
  "automation.deleted": "Eliminó una automatización",
  "automation.enabled": "Activó una automatización",
  "automation.disabled": "Pausó una automatización",
  "integration.updated": "Configuró una integración",
  "audit.exported": "Exportó la auditoría",
};

export const AUDIT_CATEGORIES = {
  sesiones: { label: "Sesiones y exportaciones", prefixes: ["auth.", "audit."] },
  usuarios: { label: "Usuarios y equipos", prefixes: ["member.", "team."] },
  permisos: { label: "Permisos", prefixes: ["permissions."] },
  configuracion: { label: "Configuración", prefixes: ["org.", "organization.", "settings.", "zone.", "tag.", "product."] },
  whatsapp: { label: "WhatsApp y plantillas", prefixes: ["whatsapp.", "template."] },
  automatizaciones: { label: "Automatizaciones", prefixes: ["automation."] },
  integraciones: { label: "Integraciones", prefixes: ["integration."] },
} as const;
export type AuditCategory = keyof typeof AUDIT_CATEGORIES;
export const AUDIT_CATEGORY_IDS = Object.keys(AUDIT_CATEGORIES) as AuditCategory[];

export const auditLabel = (action: string) => AUDIT_ACTION_LABELS[action] ?? action;

/** Acciones conocidas de una categoría (para filtrar con `in`: máximo 30). */
export function actionsOf(category: AuditCategory): string[] {
  const prefixes: readonly string[] = AUDIT_CATEGORIES[category].prefixes;
  return Object.keys(AUDIT_ACTION_LABELS).filter((a) => prefixes.some((p) => a.startsWith(p)));
}

/** Valor compacto para mostrar o exportar (los objetos se resumen en JSON). */
export function formatAuditValue(v: unknown): string {
  if (v === undefined || v === null || v === "") return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  const s = JSON.stringify(v);
  return s.length > 300 ? `${s.slice(0, 300)}…` : s;
}

/**
 * Qué cambió entre `before` y `after`, campo por campo (los dos suelen ser
 * objetos con solo los campos tocados).
 */
export function auditChanges(before: unknown, after: unknown): { field: string; before: string; after: string }[] {
  const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
  if (!isObj(before) && !isObj(after)) {
    if (before === undefined && after === undefined) return [];
    return [{ field: "valor", before: formatAuditValue(before), after: formatAuditValue(after) }];
  }
  const b = isObj(before) ? before : {};
  const a = isObj(after) ? after : {};
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].sort();
  return keys
    .map((field) => ({ field, before: formatAuditValue(b[field]), after: formatAuditValue(a[field]) }))
    .filter((c) => c.before !== c.after);
}

/** CSV (separado por coma, con comillas) que abre bien en Excel en castellano. */
export function toCsv(rows: (string | number)[][]): string {
  const cell = (v: string | number) => {
    const s = String(v);
    // Evita fórmulas al abrir en planillas (inyección CSV).
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\n;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n");
}
