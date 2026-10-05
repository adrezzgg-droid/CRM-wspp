/**
 * Plantillas de WhatsApp: variables con nombre ({{nombre}}) para que el
 * equipo las entienda, traducidas al formato posicional que exige Meta
 * ({{1}}, {{2}}…). Código puro.
 */

export const TEMPLATE_VARIABLES = ["nombre", "empresa", "vendedor", "pedido", "fecha", "importe"] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

export const TEMPLATE_VARIABLE_LABELS: Record<TemplateVariable, string> = {
  nombre: "Nombre del cliente",
  empresa: "Empresa del cliente",
  vendedor: "Vendedor responsable",
  pedido: "Número de pedido",
  fecha: "Fecha de hoy",
  importe: "Importe del pedido",
};

/** Valores de ejemplo para la vista previa (Meta también pide ejemplos al aprobar). */
export const SAMPLE_VALUES: Record<TemplateVariable, string> = {
  nombre: "José",
  empresa: "Pollería Don José",
  vendedor: "Juan",
  pedido: "P-000123",
  fecha: "05/10/2026",
  importe: "$ 138.000",
};

const VAR_RE = /\{\{\s*([a-zA-Z_]+)\s*\}\}/g;

/** Variables usadas, en orden de primera aparición y sin repetir. */
export function extractVariables(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(VAR_RE)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

export function unknownVariables(body: string): string[] {
  return extractVariables(body).filter((v) => !(TEMPLATE_VARIABLES as readonly string[]).includes(v));
}

/** Reemplaza variables; las que no tienen valor quedan vacías. */
export function renderTemplate(body: string, values: Partial<Record<string, string>>): string {
  return body.replace(VAR_RE, (_, name: string) => values[name] ?? "");
}

/**
 * Cuerpo en formato Meta: {{nombre}} → {{1}}. Una variable repetida usa el
 * mismo número. `order` dice qué valor va en cada posición al enviar.
 */
export function toMetaBody(body: string): { text: string; order: string[] } {
  const order = extractVariables(body);
  const text = body.replace(VAR_RE, (_, name: string) => `{{${order.indexOf(name) + 1}}}`);
  return { text, order };
}

/** Nombre válido para Meta: minúsculas, números y guion bajo. */
export const META_NAME_RE = /^[a-z0-9_]{1,512}$/;

export function suggestMetaName(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}
