/**
 * Filtros de la bandeja → condiciones de la consulta en tiempo real.
 * Código puro. Las condiciones tienen que ser compatibles con firestore.rules:
 * el vendedor SIEMPRE consulta `assigneeId == uid` (las reglas no son filtros).
 */
import type { CustomerStage, ConversationStatus } from "../types/model.ts";
import type { Scope } from "../server/permissions/matrix.ts";

export const INBOX_FILTERS = [
  { id: "todos", label: "Todos" },
  { id: "sin_asignar", label: "Sin asignar" },
  { id: "pendientes", label: "Pendientes" },
  { id: "en_atencion", label: "En atención" },
  { id: "mias", label: "Mis conversaciones" },
  { id: "no_respondidos", label: "No respondidos" },
  { id: "nuevos_leads", label: "Nuevos leads" },
  { id: "clientes", label: "Clientes" },
  { id: "cerrados", label: "Cerrados" },
] as const;

export type InboxFilter = (typeof INBOX_FILTERS)[number]["id"];

export type Clause = [field: string, op: "==" | "in", value: unknown];

export interface InboxQuery {
  clauses: Clause[];
  /** Alcance "equipo": se filtra en el navegador a su equipo + sin asignar. */
  teamOnly: boolean;
}

export const OPEN_STATUSES: ConversationStatus[] = ["nueva", "pendiente", "en_atencion"];
const CLIENT_STAGES: CustomerStage[] = ["cliente_nuevo", "cliente_activo", "cliente_inactivo", "cliente_perdido"];

export function isInboxFilter(value: unknown): value is InboxFilter {
  return INBOX_FILTERS.some((f) => f.id === value);
}

/** null = el filtro no puede devolver nada para este usuario. */
export function inboxQuery(filter: InboxFilter, ctx: { uid: string; scope: Scope | null }): InboxQuery | null {
  if (!ctx.scope) return null;
  const own = ctx.scope === "propio";
  const clauses: Clause[] = own ? [["assigneeId", "==", ctx.uid]] : [];
  const open: Clause = ["status", "in", OPEN_STATUSES];

  switch (filter) {
    case "todos":
      clauses.push(open);
      break;
    case "sin_asignar":
      if (own) return null;
      clauses.push(["assigneeId", "==", null], open);
      break;
    case "pendientes":
      clauses.push(["status", "in", ["nueva", "pendiente"]]);
      break;
    case "en_atencion":
      clauses.push(["status", "==", "en_atencion"]);
      break;
    case "mias":
      if (!own) clauses.push(["assigneeId", "==", ctx.uid]);
      clauses.push(open);
      break;
    case "no_respondidos":
      clauses.push(["awaitingReply", "==", true], open);
      break;
    case "nuevos_leads":
      clauses.push(["customerStage", "==", "prospecto"], open);
      break;
    case "clientes":
      clauses.push(["customerStage", "in", CLIENT_STAGES], open);
      break;
    case "cerrados":
      clauses.push(["status", "==", "cerrada"]);
      break;
  }
  return { clauses, teamOnly: ctx.scope === "equipo" && filter !== "mias" };
}
