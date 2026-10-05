import type { Metadata } from "next";
import Link from "next/link";
import { requireAccess } from "@/server/auth/guards";
import { can } from "@/server/permissions/matrix";
import { scopeAllows } from "@/server/permissions/scope";
import { getMembers, OWNER_ROLES, scopeContext } from "@/server/org/data";
import { getPipeline } from "@/server/commercial/common";
import { listOpportunities } from "@/server/commercial/opportunities";
import { columnSummary } from "@/lib/pipeline";
import { PageHeader } from "@/components/ui/page";
import { inputClass } from "@/components/ui/styles";
import { PipelineBoard } from "./pipeline-board";

export const metadata: Metadata = { title: "Pipeline" };

export default async function PipelinePage({ searchParams }: PageProps<"/pipeline">) {
  const session = await requireAccess("pipeline");
  const sp = await searchParams;
  const owner = typeof sp.owner === "string" && sp.owner ? sp.owner : undefined;
  const q = typeof sp.q === "string" && sp.q ? sp.q : undefined;
  const [pipeline, members, ctx, opportunities] = await Promise.all([
    getPipeline(session.orgId),
    getMembers(session.orgId),
    scopeContext(session, "pipeline"),
    listOpportunities(session, { owner, q }),
  ]);
  const owners =
    ctx.scope === "propio"
      ? []
      : members
          .filter((m) => m.active && OWNER_ROLES.has(m.role) && scopeAllows(ctx, m.id))
          .sort((a, b) => a.displayName.localeCompare(b.displayName, "es"))
          .map((m) => ({ id: m.id, name: m.displayName }));
  const open = opportunities.filter((o) => pipeline.stages.find((s) => s.id === o.stageId)?.kind === "abierta");
  const summary = columnSummary(open);
  const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: session.org.currency, maximumFractionDigits: 0 });

  return (
    <div className="flex h-full flex-col gap-4 p-4 sm:p-6">
      <PageHeader
        title="Pipeline"
        description={`${summary.count} oportunidades abiertas · ${money.format(summary.total)} en juego · ${money.format(summary.weighted)} ponderado`}
      />
      <form method="get" className="flex flex-wrap gap-2">
        <input name="q" defaultValue={q} placeholder="Buscar cliente o producto" className={`${inputClass} max-w-xs`} aria-label="Buscar" />
        {owners.length > 0 && (
          <select name="owner" defaultValue={owner ?? ""} className={`${inputClass} max-w-xs`} aria-label="Responsable">
            <option value="">Todos los responsables</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        )}
        <button type="submit" className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
          Filtrar
        </button>
        {(q || owner) && (
          <Link href="/pipeline" className="rounded-lg px-3 py-2 text-sm text-ink-muted hover:bg-surface">
            Limpiar
          </Link>
        )}
      </form>
      <PipelineBoard
        stages={pipeline.stages}
        initial={opportunities}
        options={{ stages: pipeline.stages, owners, currency: session.org.currency }}
        names={Object.fromEntries(members.map((m) => [m.id, m.displayName]))}
        canCreate={can(session.role, "pipeline", "crear", session.overrides)}
        canEdit={can(session.role, "pipeline", "editar", session.overrides)}
      />
    </div>
  );
}
