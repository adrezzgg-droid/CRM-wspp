import "server-only";
import { cache } from "react";
import type { GeneralSettings, Member, Tag, Team, Zone } from "@/types/model";
import { orgPath } from "@/types/model";
import { adminDb } from "@/server/firebase/admin";
import { scopeOf, type Resource } from "@/server/permissions/matrix";
import { teamUidsFor, type ScopeContext } from "@/server/permissions/scope";
import type { Session } from "@/server/auth/session";

/**
 * Datos de configuración de la organización, leídos una vez por petición.
 * Son colecciones chicas (decenas de documentos).
 */

async function all<T>(orgId: string, collection: Parameters<typeof orgPath>[1]): Promise<T[]> {
  const snap = await adminDb().collection(orgPath(orgId, collection)).get();
  return snap.docs.map((d) => ({ ...(d.data() as T), id: d.id }));
}

export const getMembers = cache((orgId: string) => all<Member>(orgId, "members"));
export const getTeams = cache((orgId: string) => all<Team>(orgId, "teams"));
export const getTags = cache((orgId: string) => all<Tag>(orgId, "tags"));
export const getZones = cache((orgId: string) => all<Zone>(orgId, "zones"));

export const DEFAULT_GENERAL_SETTINGS: Omit<GeneralSettings, "updatedAt" | "updatedBy"> = {
  defaultCountryCode: "54",
  businessHours: null,
};

export const getGeneralSettings = cache(async (orgId: string) => {
  const snap = await adminDb().collection(orgPath(orgId, "settings")).doc("general").get();
  return { ...DEFAULT_GENERAL_SETTINGS, ...(snap.data() as Partial<GeneralSettings> | undefined) };
});

export async function getMembersMap(orgId: string): Promise<Map<string, Member>> {
  return new Map((await getMembers(orgId)).map((m) => [m.id, m]));
}

/** Contexto de alcance del usuario sobre un recurso (propio / equipo / todo). */
export async function scopeContext(session: Session, resource: Resource): Promise<ScopeContext> {
  const scope = scopeOf(session.role, resource, session.overrides);
  const teamUids = scope === "equipo" ? teamUidsFor(session.uid, await getTeams(session.orgId)) : [session.uid];
  return { uid: session.uid, scope, teamUids };
}

/** Roles que pueden ser responsables de clientes y conversaciones. */
export const OWNER_ROLES = new Set(["admin", "supervisor", "vendedor"]);
