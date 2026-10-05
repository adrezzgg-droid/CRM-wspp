import "server-only";
import { can } from "@/server/permissions/matrix";
import { scopeAllows } from "@/server/permissions/scope";
import type { Session } from "@/server/auth/session";
import { getMembers, getTags, getZones, OWNER_ROLES, scopeContext } from "@/server/org/data";
import type { CustomerFormOptions } from "@/app/(app)/clientes/customer-form";

/** Opciones de los formularios y filtros de clientes, ya recortadas al alcance del usuario. */
export async function customerFormOptions(session: Session): Promise<CustomerFormOptions> {
  const [members, zones, tags, ctx] = await Promise.all([
    getMembers(session.orgId),
    getZones(session.orgId),
    getTags(session.orgId),
    scopeContext(session, "clientes"),
  ]);
  const canAssign = can(session.role, "clientes", "asignar", session.overrides);
  const owners = members
    .filter((m) => m.active && OWNER_ROLES.has(m.role) && (canAssign ? scopeAllows(ctx, m.id) : m.id === session.uid))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "es"))
    .map((m) => ({ id: m.id, name: m.displayName }));
  return {
    owners,
    zones: zones.sort((a, b) => a.name.localeCompare(b.name, "es")).map((z) => ({ id: z.id, name: z.name })),
    tags: tags.sort((a, b) => a.name.localeCompare(b.name, "es")).map((t) => ({ id: t.id, name: t.name, color: t.color })),
    canAssign,
  };
}
