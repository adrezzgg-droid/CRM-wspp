/**
 * Reglas de asignación y de demora. Código puro: lo usan la ingestión,
 * la tarea programada y las pruebas.
 */
import type { AssignmentSettings, Assignment, LeadStatus } from "../types/model.ts";

export const DEFAULT_ASSIGNMENT_SETTINGS: Omit<AssignmentSettings, "updatedAt" | "updatedBy"> = {
  autoAssign: true,
  useZones: true,
  zoneFallback: true,
  slaEnabled: true,
  slaMinutes: 15,
};

export interface Candidate {
  id: string;
  role: string;
  active: boolean;
  available: boolean;
  zoneIds?: string[];
  lastAutoAssignedAt?: number;
}

export interface AssigneePick {
  id: string;
  reason: Extract<Assignment["reason"], "regla_zona" | "regla_nuevo">;
}

/** Turno rotativo: el que hace más tiempo que no recibe (o nunca recibió). */
function nextInTurn(list: Candidate[]): Candidate | undefined {
  return [...list].sort((a, b) => (a.lastAutoAssignedAt ?? 0) - (b.lastAutoAssignedAt ?? 0) || a.id.localeCompare(b.id))[0];
}

/**
 * Elige vendedor para una conversación nueva sin responsable:
 *  1. Si hay zona y está activado, un vendedor disponible de esa zona.
 *  2. Si no (o nadie la cubre y se permite), cualquier vendedor disponible.
 * Siempre por turno rotativo. null = no hay a quién asignar.
 */
export function pickAssignee(
  candidates: Candidate[],
  opts: Pick<AssignmentSettings, "useZones" | "zoneFallback"> & { zoneId?: string },
): AssigneePick | null {
  const eligible = candidates.filter((c) => c.active && c.available && c.role === "vendedor");
  if (opts.useZones && opts.zoneId) {
    const inZone = eligible.filter((c) => c.zoneIds?.includes(opts.zoneId!));
    const chosen = nextInTurn(inZone);
    if (chosen) return { id: chosen.id, reason: "regla_zona" };
    if (!opts.zoneFallback) return null;
  }
  const chosen = nextInTurn(eligible);
  return chosen ? { id: chosen.id, reason: "regla_nuevo" } : null;
}

/** ¿La espera actual superó el máximo y todavía no se avisó? */
export function slaBreached(
  c: { awaitingReply: boolean; awaitingSince?: number; slaAlertedAt?: number; status: string },
  minutes: number,
  now = Date.now(),
): boolean {
  if (!c.awaitingReply || c.awaitingSince == null || c.status === "cerrada") return false;
  if (c.slaAlertedAt && c.slaAlertedAt >= c.awaitingSince) return false;
  return now - c.awaitingSince >= minutes * 60_000;
}

/** Minutos que lleva esperando (para mostrar). */
export function waitingMinutes(awaitingSince: number | undefined, now = Date.now()): number {
  return awaitingSince == null ? 0 : Math.max(0, Math.floor((now - awaitingSince) / 60_000));
}

/** Recorrido "feliz" del lead, en orden. "perdido" puede ocurrir en cualquier punto. */
export const LEAD_FLOW: LeadStatus[] = ["recibido", "asignado", "contactado", "en_negociacion", "pedido_generado", "venta_realizada", "cerrado"];

/**
 * Estado que debería tener el lead tras un evento automático: nunca retrocede
 * (si un vendedor ya lo llevó a negociación, asignarlo de nuevo no lo vuelve a "asignado").
 */
export function advanceLead(current: LeadStatus, to: LeadStatus): LeadStatus {
  if (current === "perdido" || current === "cerrado") return current;
  return LEAD_FLOW.indexOf(to) > LEAD_FLOW.indexOf(current) ? to : current;
}
