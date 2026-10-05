import type { Metadata } from "next";
import { requireAccess } from "@/server/auth/guards";
import { can } from "@/server/permissions/matrix";
import { scopeAllows } from "@/server/permissions/scope";
import { getMembers, getTags, getTeams, OWNER_ROLES, scopeContext } from "@/server/org/data";
import { getAssignmentSettings } from "@/server/org/assignment";
import { customerFormOptions } from "@/server/customers/options";
import { getPipeline } from "@/server/commercial/common";
import { listProducts } from "@/server/commercial/products";
import { InboxApp } from "./inbox-app";

export const metadata: Metadata = { title: "Bandeja" };

export default async function InboxPage() {
  const session = await requireAccess("inbox");
  const [members, tags, ctx, teams, assignment] = await Promise.all([
    getMembers(session.orgId),
    getTags(session.orgId),
    scopeContext(session, "inbox"),
    getTeams(session.orgId),
    getAssignmentSettings(session.orgId),
  ]);
  const myTeams = teams.filter((t) => t.leaderIds.includes(session.uid));
  const canCreateOpp = can(session.role, "pipeline", "crear", session.overrides);
  const canCreateOrder = session.role !== "repartidor" && can(session.role, "pedidos", "crear", session.overrides);
  const pipelineCtx = canCreateOpp ? await scopeContext(session, "pipeline") : null;
  const [pipeline, products] = await Promise.all([
    canCreateOpp ? getPipeline(session.orgId) : null,
    canCreateOrder ? listProducts(session) : null,
  ]);
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
      myTeamIds={myTeams.map((t) => t.id)}
      teams={(canAssign ? (ctx.scope === "todo" ? teams : myTeams) : []).map((t) => ({ id: t.id, name: t.name }))}
      sla={{ enabled: assignment.slaEnabled, minutes: assignment.slaMinutes }}
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
      currency={session.org.currency}
      opportunityOptions={
        pipeline && pipelineCtx
          ? {
              stages: pipeline.stages,
              currency: session.org.currency,
              owners:
                pipelineCtx.scope === "propio"
                  ? []
                  : members.filter((m) => m.active && OWNER_ROLES.has(m.role) && scopeAllows(pipelineCtx, m.id)).map((m) => ({ id: m.id, name: m.displayName })),
            }
          : null
      }
      orderProducts={products ? products.map((x) => ({ id: x.id, name: x.name, sku: x.sku, unit: x.unit, price: x.price })) : null}
    />
  );
}
