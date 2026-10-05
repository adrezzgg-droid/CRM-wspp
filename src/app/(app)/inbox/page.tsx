import type { Metadata } from "next";
import { requireAccess } from "@/server/auth/guards";
import { can } from "@/server/permissions/matrix";
import { scopeAllows } from "@/server/permissions/scope";
import { getMembers, getTags, OWNER_ROLES, scopeContext } from "@/server/org/data";
import { customerFormOptions } from "@/server/customers/options";
import { InboxApp } from "./inbox-app";

export const metadata: Metadata = { title: "Bandeja" };

export default async function InboxPage() {
  const session = await requireAccess("inbox");
  const [members, tags, ctx] = await Promise.all([getMembers(session.orgId), getTags(session.orgId), scopeContext(session, "inbox")]);
  const canAssign = can(session.role, "inbox", "asignar", session.overrides);
  const canEditCustomer = can(session.role, "clientes", "editar", session.overrides);

  return (
    <InboxApp
      uid={session.uid}
      orgId={session.orgId}
      timezone={session.org.timezone}
      isDemo={session.org.isDemo}
      scope={ctx.scope}
      teamUids={[...ctx.teamUids]}
      members={members.map((m) => ({ id: m.id, name: m.displayName, role: m.role, active: m.active }))}
      assignable={
        canAssign
          ? members
              .filter((m) => m.active && OWNER_ROLES.has(m.role) && scopeAllows(ctx, m.id))
              .sort((a, b) => a.displayName.localeCompare(b.displayName, "es"))
              .map((m) => ({ id: m.id, name: m.displayName }))
          : []
      }
      tags={tags.sort((a, b) => a.name.localeCompare(b.name, "es")).map((t) => ({ id: t.id, name: t.name, color: t.color }))}
      canEdit={can(session.role, "inbox", "editar", session.overrides)}
      canAssign={canAssign}
      customerOptions={canEditCustomer ? await customerFormOptions(session) : null}
      canEditCustomer={canEditCustomer}
    />
  );
}
