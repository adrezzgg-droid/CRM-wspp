/**
 * Alcance de visibilidad sobre documentos con responsable (cliente, oportunidad,
 * conversación...). Código puro: el servidor resuelve los uids del equipo y
 * esta función decide.
 */
import type { Scope } from "./matrix.ts";

export interface ScopeContext {
  uid: string;
  scope: Scope | null;
  /** Usuarios de los equipos que lidera (incluye al propio usuario). */
  teamUids: readonly string[];
}

/** ¿Puede ver/operar un documento cuyo responsable es `ownerId`? */
export function scopeAllows(ctx: ScopeContext, ownerId: string | null | undefined): boolean {
  switch (ctx.scope) {
    case "todo":
      return true;
    case "equipo":
      // Lo sin asignar también es visible: el supervisor es quien lo reparte.
      return !ownerId || ctx.teamUids.includes(ownerId);
    case "propio":
      return !!ownerId && ownerId === ctx.uid;
    default:
      return false;
  }
}

/** Uids de los equipos que lidera `uid` (líderes y miembros), incluido él mismo. */
export function teamUidsFor(
  uid: string,
  teams: readonly { leaderIds: readonly string[]; memberIds: readonly string[] }[],
): string[] {
  const set = new Set<string>([uid]);
  for (const t of teams) {
    if (!t.leaderIds.includes(uid)) continue;
    for (const id of [...t.leaderIds, ...t.memberIds]) set.add(id);
  }
  return [...set];
}
