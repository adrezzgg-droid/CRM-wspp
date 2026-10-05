import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CalendarCheck, Inbox, Package, Sparkles, SquareKanban, Users } from "lucide-react";
import { requireAccess } from "@/server/auth/guards";
import { can } from "@/server/permissions/matrix";
import { getMyDay } from "@/server/my-day";
import { getPipeline } from "@/server/commercial/common";
import { taskFormOptions } from "@/server/tasks/options";
import { formatWhatsappId } from "@/lib/phone";
import { waitingMinutes } from "@/lib/assignment";
import { PageBody } from "@/components/ui/page";
import { OrderStatusBadge } from "@/components/ui/order-badge";
import { TaskList } from "@/components/tasks/task-list";
import { NewTaskButton } from "@/components/tasks/task-form";

export const metadata: Metadata = { title: "Mi día" };

function Block({ title, icon: Icon, count, href, children }: { title: string; icon: typeof Inbox; count?: number; href?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface">
      <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Icon className="size-4 text-brand-600" aria-hidden /> {title}
          {count !== undefined && <span className="rounded-full bg-canvas px-2 text-xs text-ink-muted">{count}</span>}
        </h2>
        {href && (
          <Link href={href} className="flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
            Ver todo <ArrowRight className="size-3" aria-hidden />
          </Link>
        )}
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => <p className="px-1 py-2 text-sm text-ink-muted">{children}</p>;

export default async function MyDayPage() {
  const session = await requireAccess("mi_dia");
  const day = await getMyDay(session);
  const now = day.now;
  const tz = session.org.timezone;
  const hour = Number(new Intl.DateTimeFormat("es-AR", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(now));
  const greeting = hour < 12 ? "Buen día" : hour < 20 ? "Buenas tardes" : "Buenas noches";
  const today = new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long", timeZone: tz }).format(now);
  const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: session.org.currency, maximumFractionDigits: 0 });
  const time = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: tz });
  const canTasks = can(session.role, "tareas", "crear", session.overrides);
  const options = day.todayTasks ? await taskFormOptions(session) : null;
  const stages = day.opportunities ? new Map((await getPipeline(session.orgId)).stages.map((s) => [s.id, s.name])) : new Map<string, string>();
  const isDriver = session.role === "repartidor";
  const firstName = session.member.displayName.split(" ")[0];

  const kpis = [
    day.newLeads && { label: "Nuevos leads", value: day.newLeads.length, href: "/inbox?f=nuevos_leads", tone: "brand" },
    day.unanswered && { label: "Sin responder", value: day.unanswered.length, href: "/inbox?f=no_respondidos", tone: day.unanswered.length ? "warn" : "brand" },
    day.todayTasks && { label: "Tareas de hoy", value: day.todayTasks.length, href: "/tareas?vista=hoy", tone: "brand" },
    day.overdueTasks && { label: "Tareas vencidas", value: day.overdueTasks.length, href: "/tareas?vista=vencidas", tone: day.overdueTasks.length ? "danger" : "brand" },
    day.orders && { label: isDriver ? "Entregas pendientes" : "Pedidos de hoy", value: day.orders.length, href: "/pedidos", tone: "brand" },
  ].filter(Boolean) as { label: string; value: number; href: string; tone: "brand" | "warn" | "danger" }[];
  const tones = { brand: "text-ink", warn: "text-amber-700", danger: "text-red-700" };

  return (
    <PageBody>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">
            {greeting}, {firstName}
          </h1>
          <p className="text-sm text-ink-muted first-letter:uppercase">{today}</p>
        </div>
        {canTasks && options && <NewTaskButton options={options} variant="secondary" />}
      </div>

      {kpis.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {kpis.map((k) => (
            <Link key={k.label} href={k.href} className="rounded-xl border border-line bg-surface px-4 py-3 hover:border-brand-300">
              <p className="text-xs text-ink-muted">{k.label}</p>
              <p className={`mt-1 text-2xl font-semibold ${tones[k.tone]}`}>{k.value}</p>
            </Link>
          ))}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {(day.newLeads || day.unanswered) && (
          <Block title="Para responder" icon={Inbox} count={(day.unanswered?.length ?? 0)} href="/inbox?f=no_respondidos">
            {!day.unanswered?.length ? (
              <Empty>No tenés mensajes sin responder.</Empty>
            ) : (
              <ul className="divide-y divide-line">
                {day.unanswered.slice(0, 8).map((c) => {
                  const mins = waitingMinutes(c.awaitingSince, now);
                  const isNew = c.customerStage === "prospecto" && !c.firstResponseAt;
                  return (
                    <li key={c.id}>
                      <Link href={`/inbox?c=${c.id}`} className="flex items-center gap-3 rounded-lg px-1 py-2 hover:bg-canvas">
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2 text-sm font-medium">
                            <span className="truncate">{c.contactName}</span>
                            {isNew && <span className="rounded bg-sky-100 px-1.5 text-[10px] font-semibold text-sky-800 uppercase">Nuevo lead</span>}
                          </span>
                          <span className="block truncate text-xs text-ink-muted">{c.lastMessagePreview ?? formatWhatsappId(c.waContactId)}</span>
                        </span>
                        <span className={`shrink-0 text-xs font-medium ${mins >= 15 ? "text-red-700" : "text-ink-muted"}`}>{mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h`}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Block>
        )}

        {day.todayTasks && (
          <Block title="Tareas" icon={CalendarCheck} count={day.todayTasks.length + (day.overdueTasks?.length ?? 0)} href="/tareas">
            <TaskList
              tasks={[...(day.overdueTasks ?? []), ...day.todayTasks]}
              timezone={tz}
              canEdit={can(session.role, "tareas", "editar", session.overrides)}
              options={options}
              uid={session.uid}
              names={{}}
              empty="No tenés tareas para hoy ni vencidas."
            />
          </Block>
        )}

        {day.orders && (
          <Block title={isDriver ? "Entregas pendientes" : "Pedidos de hoy"} icon={Package} count={day.orders.length} href="/pedidos">
            {!day.orders.length ? (
              <Empty>{isDriver ? "No tenés entregas pendientes." : "Todavía no cargaste pedidos hoy."}</Empty>
            ) : (
              <ul className="divide-y divide-line">
                {day.orders.slice(0, 8).map((o) => (
                  <li key={o.id}>
                    <Link href={`/pedidos/${o.id}`} className="flex items-center gap-3 rounded-lg px-1 py-2 hover:bg-canvas">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          <span className="font-mono text-xs text-ink-muted">{o.number}</span> {o.customerName}
                        </span>
                        <span className="block truncate text-xs text-ink-muted">{isDriver ? o.deliveryAddress ?? "Sin dirección" : time.format(o.createdAt)}</span>
                      </span>
                      <OrderStatusBadge status={o.status} />
                      <span className="text-sm font-medium">{money.format(o.total)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Block>
        )}

        {day.opportunities && (
          <Block title="Oportunidades" icon={SquareKanban} count={day.opportunities.length} href="/pipeline">
            {!day.opportunities.length ? (
              <Empty>No tenés oportunidades abiertas.</Empty>
            ) : (
              <ul className="divide-y divide-line">
                {day.opportunities.map((o) => (
                  <li key={o.id} className="flex items-center gap-3 px-1 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{o.customerName}</span>
                      <span className="block truncate text-xs text-ink-muted">
                        {stages.get(o.stageId) ?? o.stageId}
                        {o.nextAction ? ` · ${o.nextAction}` : ""}
                      </span>
                    </span>
                    <span className="text-sm font-medium">{money.format(o.estimatedValue)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Block>
        )}

        {day.toFollow && (
          <Block title="Clientes para reactivar" icon={Users} count={day.toFollow.length} href="/clientes?reactivar=1">
            {!day.toFollow.length ? (
              <Empty>No tenés clientes marcados para reactivar.</Empty>
            ) : (
              <ul className="divide-y divide-line">
                {day.toFollow.map((c) => (
                  <li key={c.id}>
                    <Link href={`/clientes/${c.id}`} className="flex items-center gap-3 rounded-lg px-1 py-2 hover:bg-canvas">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{c.name}</span>
                        <span className="block truncate text-xs text-ink-muted">{[c.company, c.lastPurchaseAt ? `última compra ${new Date(c.lastPurchaseAt).toLocaleDateString("es-AR")}` : "sin compras registradas"].filter(Boolean).join(" · ")}</span>
                      </span>
                      <ArrowRight className="size-4 text-ink-muted" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Block>
        )}
      </div>

      {!kpis.length && (
        <p className="flex items-center gap-2 rounded-xl border border-dashed border-line bg-surface px-4 py-6 text-sm text-ink-muted">
          <Sparkles className="size-4" aria-hidden /> Tu rol no tiene módulos de trabajo diario asignados.
        </p>
      )}
    </PageBody>
  );
}
