import type { Metadata } from "next";
import Link from "next/link";
import { requireAccess } from "@/server/auth/guards";
import { can } from "@/server/permissions/matrix";
import { scopeAllows } from "@/server/permissions/scope";
import { getMembers, scopeContext } from "@/server/org/data";
import { listTasks, taskCounts } from "@/server/tasks/service";
import { taskFormOptions } from "@/server/tasks/options";
import { taskListQuery } from "@/lib/schemas";
import { TASK_VIEWS, TASK_VIEW_LABELS } from "@/lib/tasks";
import { PageBody, PageHeader } from "@/components/ui/page";
import { inputClass } from "@/components/ui/styles";
import { TaskList } from "@/components/tasks/task-list";
import { NewTaskButton } from "@/components/tasks/task-form";

export const metadata: Metadata = { title: "Tareas" };

const EMPTY: Record<(typeof TASK_VIEWS)[number], string> = {
  hoy: "No hay tareas para hoy.",
  vencidas: "No hay tareas vencidas. ¡Bien!",
  proximas: "No hay tareas programadas para los próximos días.",
  completadas: "Todavía no hay tareas completadas.",
};

export default async function TasksPage({ searchParams }: PageProps<"/tareas">) {
  const session = await requireAccess("tareas");
  const raw = await searchParams;
  const parsed = taskListQuery.safeParse(Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === "string" && v)));
  const filters = parsed.success ? parsed.data : { vista: "hoy" as const };
  const [tasks, counts, members, ctx] = await Promise.all([
    listTasks(session, filters),
    taskCounts(session, filters.responsable),
    getMembers(session.orgId),
    scopeContext(session, "tareas"),
  ]);
  const canCreate = can(session.role, "tareas", "crear", session.overrides);
  const options = canCreate || can(session.role, "tareas", "editar", session.overrides) ? await taskFormOptions(session) : null;
  const people = ctx.scope === "propio" ? [] : members.filter((m) => m.active && m.role !== "solo_lectura" && scopeAllows(ctx, m.id));
  const href = (vista: string) => `/tareas?${new URLSearchParams({ vista, ...(filters.responsable ? { responsable: filters.responsable } : {}) })}`;

  return (
    <PageBody>
      <PageHeader
        title="Tareas"
        description={ctx.scope === "propio" ? "Tu seguimiento comercial." : ctx.scope === "equipo" ? "Seguimiento de tu equipo." : "Seguimiento de todo el equipo comercial."}
        actions={canCreate && options ? <NewTaskButton options={options} /> : undefined}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav role="tablist" aria-label="Vistas" className="-mx-1 flex gap-1 overflow-x-auto px-1">
          {TASK_VIEWS.map((v) => {
            const count = v === "completadas" ? null : counts[v];
            const active = filters.vista === v;
            return (
              <Link
                key={v}
                role="tab"
                aria-selected={active}
                href={href(v)}
                className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm whitespace-nowrap ${active ? "bg-brand-600 font-medium text-white" : "bg-surface text-ink-muted hover:text-ink"}`}
              >
                {TASK_VIEW_LABELS[v]}
                {count !== null && count > 0 && (
                  <span className={`rounded-full px-1.5 text-xs ${active ? "bg-white/20" : v === "vencidas" ? "bg-red-100 text-red-700" : "bg-canvas"}`}>{count}</span>
                )}
              </Link>
            );
          })}
        </nav>
        {people.length > 0 && (
          <form method="get" className="flex gap-2">
            <input type="hidden" name="vista" value={filters.vista} />
            <select name="responsable" defaultValue={filters.responsable ?? ""} className={`${inputClass} max-w-56`} aria-label="Responsable">
              <option value="">Todos los responsables</option>
              {people.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName}
                </option>
              ))}
            </select>
            <button type="submit" className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
              Filtrar
            </button>
          </form>
        )}
      </div>

      <TaskList
        tasks={tasks}
        timezone={session.org.timezone}
        canEdit={can(session.role, "tareas", "editar", session.overrides)}
        options={options}
        uid={session.uid}
        names={Object.fromEntries(members.map((m) => [m.id, m.displayName]))}
        empty={EMPTY[filters.vista]}
      />
    </PageBody>
  );
}
