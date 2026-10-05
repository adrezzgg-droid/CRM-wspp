import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import type { Member, Organization } from "@/types/model";
import { orgPath, COLLECTIONS } from "@/types/model";
import { isRole, type PolicyOverrides, type Role } from "@/server/permissions/matrix";
import { adminAuth, adminDb } from "@/server/firebase/admin";

export const SESSION_COOKIE = "__session";

/** Lo que el servidor sabe del usuario autenticado en cada petición. */
export interface Session {
  uid: string;
  email: string;
  orgId: string;
  role: Role;
  member: Pick<Member, "displayName" | "teamIds" | "zoneIds" | "available">;
  org: Pick<Organization, "id" | "name" | "isDemo" | "timezone" | "currency">;
  overrides: PolicyOverrides;
}

export type PrincipalError =
  | "sin_organizacion"
  | "organizacion_inexistente"
  | "organizacion_suspendida"
  | "miembro_inexistente"
  | "miembro_inactivo"
  | "rol_desactualizado";

/**
 * Valida que los custom claims (orgId, role) sigan coincidiendo con Firestore.
 * Se usa al iniciar sesión y en cada petición: un usuario dado de baja o con
 * el rol cambiado pierde el acceso aunque su cookie siga vigente.
 */
export async function loadPrincipal(
  uid: string,
  email: string,
  claims: Record<string, unknown>,
): Promise<{ session: Session } | { error: PrincipalError }> {
  const orgId = claims.orgId;
  const role = claims.role;
  if (typeof orgId !== "string" || !orgId || !isRole(role)) return { error: "sin_organizacion" };

  const db = adminDb();
  const [orgSnap, memberSnap, permSnap] = await Promise.all([
    db.collection(COLLECTIONS.organizations).doc(orgId).get(),
    db.collection(orgPath(orgId, "members")).doc(uid).get(),
    db.collection(orgPath(orgId, "settings")).doc("permissions").get(),
  ]);

  if (!orgSnap.exists) return { error: "organizacion_inexistente" };
  const org = orgSnap.data() as Organization;
  if (org.status !== "active") return { error: "organizacion_suspendida" };

  if (!memberSnap.exists) return { error: "miembro_inexistente" };
  const member = memberSnap.data() as Member;
  if (!member.active) return { error: "miembro_inactivo" };
  // El rol se cambia en Firestore y en los claims a la vez; si no coinciden,
  // el token es viejo y se exige volver a iniciar sesión.
  if (member.role !== role) return { error: "rol_desactualizado" };

  return {
    session: {
      uid,
      email,
      orgId,
      role,
      member: {
        displayName: member.displayName,
        teamIds: member.teamIds ?? [],
        zoneIds: member.zoneIds ?? [],
        available: member.available,
      },
      org: {
        id: orgId,
        name: org.name,
        isDemo: org.isDemo,
        timezone: org.timezone,
        currency: org.currency,
      },
      overrides: (permSnap.data()?.overrides as PolicyOverrides | undefined) ?? {},
    },
  };
}

/**
 * Sesión de la petición actual (memorizada por petición con `cache`).
 * Verifica la cookie contra Firebase, incluida la revocación de tokens.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const cookie = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!cookie) return null;
  try {
    const decoded = await adminAuth().verifySessionCookie(cookie, true);
    const result = await loadPrincipal(decoded.uid, decoded.email ?? "", decoded);
    return "session" in result ? result.session : null;
  } catch {
    return null;
  }
});
