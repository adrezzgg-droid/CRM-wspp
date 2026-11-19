/**
 * Filtros de la bandeja → condiciones de la consulta en tiempo real.
 * Código puro. Las condiciones tienen que ser compatibles con firestore.rules
 * (las reglas no son filtros): el vendedor SIEMPRE consulta `assigneeId == uid`
 * y el supervisor, `assigneeId in <su equipo>` más `assigneeId == null` en
 * consultas separadas (las reglas no validan un `in` que incluya null).
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
  /** Condiciones del filtro (sin el alcance del supervisor). */
  clauses: Clause[];
  /** Consultas a hacer; el resultado es la unión (sin repetidos). */
  variants: Clause[][];
}

/** Firestore admite hasta 30 combinaciones de valores `in` por consulta. */
const MAX_DISJUNCTIONS = 30;

export const OPEN_STATUSES: ConversationStatus[] = ["nueva", "pendiente", "en_atencion"];
const CLIENT_STAGES: CustomerStage[] = ["cliente_nuevo", "cliente_activo", "cliente_inactivo", "cliente_perdido"];

export function isInboxFilter(value: unknown): value is InboxFilter {
  return INBOX_FILTERS.some((f) => f.id === value);
}

/** null = el filtro no puede devolver nada para este usuario. */
export function inboxQuery(filter: InboxFilter, ctx: { uid: string; scope: Scope | null; scopeUids?: readonly string[] }): InboxQuery | null {
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
  if (ctx.scope !== "equipo" || filter === "mias" || filter === "sin_asignar") return { clauses, variants: [clauses] };

  // Supervisor: su equipo (en tandas que respeten el límite de Firestore) + lo sin asignar.
  const team = [...new Set([ctx.uid, ...(ctx.scopeUids ?? [])])];
  const otherIn = clauses.filter(([, op]) => op === "in").reduce((n, [, , v]) => n * (v as unknown[]).length, 1);
  const size = Math.max(1, Math.floor(MAX_DISJUNCTIONS / otherIn));
  const variants: Clause[][] = [];
  for (let i = 0; i < team.length; i += size) variants.push([...clauses, ["assigneeId", "in", team.slice(i, i + size)]]);
  variants.push([...clauses, ["assigneeId", "==", null]]);
  return { clauses, variants };
}
