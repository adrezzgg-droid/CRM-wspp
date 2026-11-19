/**
 * Alcance de lectura de la bandeja en la ficha de cada usuario, para que las
 * reglas de Firestore lo apliquen en el navegador (firestore.rules → inboxSees).
 *
 *   inboxScope: "todo" | "equipo" | "propio" | "" (sin bandeja)
 *   scopeUids:  con "equipo", los usuarios de los equipos que lidera (incluido él)
 *
 * Se recalcula para toda la empresa cuando cambian usuarios, roles, permisos o
 * equipos. Sin Next: lo usan los servicios, el seed y las pruebas.
 */
import type { Firestore } from "firebase-admin/firestore";
import type { Member, Team } from "../../types/model.ts";
import { scopeOf, type PolicyOverrides } from "../permissions/matrix.ts";
import { teamUidsFor } from "../permissions/scope.ts";

export function accessScopeFor(m: Pick<Member, "id" | "role">, teams: Pick<Team, "leaderIds" | "memberIds">[], overrides: PolicyOverrides) {
  const scope = scopeOf(m.role, "inbox", overrides) ?? "";
  return { inboxScope: scope, scopeUids: scope === "equipo" ? teamUidsFor(m.id, teams).sort() : [] };
}

/** Devuelve cuántas fichas cambiaron. */
export async function syncAccessScopes(db: Firestore, orgId: string): Promise<number> {
  const org = db.collection("organizations").doc(orgId);
  const [members, teams, perms] = await Promise.all([org.collection("members").get(), org.collection("teams").get(), org.collection("settings").doc("permissions").get()]);
  const overrides = (perms.data()?.overrides as PolicyOverrides | undefined) ?? {};
  const teamList = teams.docs.map((d) => d.data() as Team);
  const batch = db.batch();
  let changed = 0;
  for (const d of members.docs) {
    const m = { ...(d.data() as Member & { inboxScope?: string; scopeUids?: string[] }), id: d.id };
    const next = accessScopeFor(m, teamList, overrides);
    if (m.inboxScope === next.inboxScope && JSON.stringify(m.scopeUids ?? []) === JSON.stringify(next.scopeUids)) continue;
    batch.update(d.ref, next);
    changed += 1;
  }
  if (changed) await batch.commit();
  return changed;
}
