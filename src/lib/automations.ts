/**
 * Reglas de automatización: etiquetas legibles, condiciones y claves de
 * idempotencia. Código puro.
 */
import type { Automation, AutomationAction, AutomationConditions, AutomationTrigger, Customer } from "../types/model.ts";

export const TRIGGER_LABELS: Record<AutomationTrigger, string> = {
  mensaje_nuevo_contacto: "Entra un WhatsApp de un contacto nuevo",
  sin_respuesta_cliente: "El cliente no responde",
  pedido_creado: "Se confirma un pedido",
  sin_compra_dias: "El cliente no compra hace un tiempo",
};

export const ACTION_LABELS: Record<AutomationAction["type"], string> = {
  enviar_mensaje: "Enviar mensaje",
  agregar_etiqueta: "Agregar etiqueta",
  crear_tarea: "Crear tarea",
  cambiar_estado_cliente: "Cambiar etapa del cliente",
  marcar_reactivar: "Marcar para reactivar",
  notificar: "Avisar",
};

/** Disparadores que corren en el momento (los demás, en la revisión periódica). */
export const EVENT_TRIGGERS: AutomationTrigger[] = ["mensaje_nuevo_contacto", "pedido_creado"];

export function conditionsMatch(c: AutomationConditions, customer: Pick<Customer, "stage" | "zoneId">): boolean {
  if (c.stages?.length && !c.stages.includes(customer.stage)) return false;
  if (c.zoneIds?.length && (!customer.zoneId || !c.zoneIds.includes(customer.zoneId))) return false;
  return true;
}

/** Texto de una línea para el listado: "SI … ENTONCES …". */
export function describeTrigger(a: Pick<Automation, "trigger" | "triggerParams" | "delayMinutes">): string {
  let text = TRIGGER_LABELS[a.trigger];
  if (a.trigger === "sin_respuesta_cliente") text += ` en ${a.triggerParams.hours ?? 24} h`;
  if (a.trigger === "sin_compra_dias") text += ` (${a.triggerParams.days ?? 30} días)`;
  if (a.delayMinutes > 0) text += ` · espera ${a.delayMinutes >= 60 ? `${Math.round(a.delayMinutes / 60)} h` : `${a.delayMinutes} min`}`;
  return text;
}

/**
 * Clave del "caso" sobre el que corre una regla. La misma regla no se ejecuta
 * dos veces para la misma clave (el registro de la ejecución usa este id).
 */
export function subjectKey(trigger: AutomationTrigger, ctx: { customerId: string; conversationId?: string; orderId?: string; since?: number }): string {
  switch (trigger) {
    case "mensaje_nuevo_contacto":
      return `conv:${ctx.conversationId ?? ctx.customerId}`;
    case "pedido_creado":
      return `pedido:${ctx.orderId}`;
    case "sin_respuesta_cliente":
      return `espera:${ctx.conversationId}:${ctx.since}`;
    case "sin_compra_dias":
      return `compra:${ctx.customerId}:${ctx.since ?? 0}`;
  }
}

/** Id de documento válido para el registro: sin barras. */
export function runId(automationId: string, key: string): string {
  return `${automationId}__${key.replace(/[/\s]/g, "_")}`.slice(0, 1400);
}
