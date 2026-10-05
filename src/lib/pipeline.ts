/**
 * Pipeline comercial: relación entre etapas, probabilidad y recorrido del lead.
 * Código puro.
 */
import type { LeadStatus, Opportunity, PipelineStage } from "../types/model.ts";

/** Etapa del pipeline → estado del lead (solo avanza, ver advanceLead). */
const STAGE_TO_LEAD: Record<string, LeadStatus> = {
  contactado: "contactado",
  interesado: "contactado",
  cotizacion: "en_negociacion",
  negociacion: "en_negociacion",
  pedido: "pedido_generado",
  venta: "venta_realizada",
  seguimiento: "venta_realizada",
  perdido: "perdido",
};

export function leadStatusForStage(stage: Pick<PipelineStage, "id" | "kind">): LeadStatus | null {
  if (stage.kind === "perdida") return "perdido";
  return STAGE_TO_LEAD[stage.id] ?? null;
}

export interface ColumnSummary {
  count: number;
  total: number;
  /** Suma de valor × probabilidad. */
  weighted: number;
}

export function columnSummary(opps: Pick<Opportunity, "estimatedValue" | "probability">[]): ColumnSummary {
  let total = 0;
  let weighted = 0;
  for (const o of opps) {
    total += o.estimatedValue;
    weighted += (o.estimatedValue * o.probability) / 100;
  }
  return { count: opps.length, total: Math.round(total * 100) / 100, weighted: Math.round(weighted * 100) / 100 };
}

/** Días en la etapa actual (para marcar oportunidades estancadas). */
export function daysInStage(stageChangedAt: number, now = Date.now()): number {
  return Math.max(0, Math.floor((now - stageChangedAt) / 86_400_000));
}
