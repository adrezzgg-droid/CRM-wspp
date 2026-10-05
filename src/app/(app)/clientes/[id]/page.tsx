import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarClock, MessageCircle } from "lucide-react";
import { requireAccess } from "@/server/auth/guards";
import { ApiError } from "@/server/api/handler";
import { can } from "@/server/permissions/matrix";
import { getCustomer360, type Customer360 } from "@/server/customers/service";
import { customerFormOptions } from "@/server/customers/options";
import { getMembersMap, getTags, getZones } from "@/server/org/data";
import { formatWhatsappId } from "@/lib/phone";
import { CONVERSATION_STATUS_LABELS } from "@/types/model";
import { PageBody } from "@/components/ui/page";
import { Badge, StageBadge, TagChip } from "@/components/ui/badges";
import { ActivityTimeline } from "@/components/activity/timeline";
import { ContactsPanel, CustomerActions, NoteForm } from "./customer-panels";

export const metadata: Metadata = { title: "Cliente" };

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {aside}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-ink-muted">{children}</p>;
}

export default async function CustomerPage({ params }: PageProps<"/clientes/[id]">) {
  const session = await requireAccess("clientes");
  const { id } = await params;

  let data: Customer360;
  try {
    data = await getCustomer360(session, id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  const [options, members, tags, zones] = await Promise.all([
    customerFormOptions(session),
    getMembersMap(session.orgId),
    getTags(session.orgId),
    getZones(session.orgId),
  ]);
  const { customer: c, contacts, notes, activities, conversations, orders, tasks, opportunities } = data;
  const tz = session.org.timezone;
  const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: session.org.currency, maximumFractionDigits: 0 });
  const date = new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeZone: tz });
  const dateTime = new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short", timeZone: tz });
  const tagsById = new Map(tags.map((t) => [t.id, t]));
  const lookups = {
    members: new Map([...members.values()].map((m) => [m.id, m.displayName])),
    tags: new Map(tags.map((t) => [t.id, t.name])),
    zones: new Map(zones.map((z) => [z.id, z.name])),
  };
  const canEdit = can(session.role, "clientes", "editar", session.overrides);
  const canNote = can(session.role, "clientes", "crear", session.overrides);
  const nextTask = tasks[0];
  const nextOpportunity = opportunities.find((o) => o.nextAction);

  const facts: [string, React.ReactNode][] = [
    ["WhatsApp", c.whatsappId ? formatWhatsappId(c.whatsappId) : "—"],
    ["Teléfono", c.phone ?? "—"],
    ["Email", c.email ? <a key="m" href={`mailto:${c.email}`} className="text-brand-700 hover:underline">{c.email}</a> : "—"],
    ["Dirección", c.address ?? "—"],
    ["Barrio", c.neighborhood ?? "—"],
    ["Localidad", c.locality ?? "—"],
    ["Zona", c.zoneId ? lookups.zones.get(c.zoneId) ?? "—" : "—"],
    ["Rubro", c.industry ?? "—"],
    ["Tipo", c.customerType ?? "—"],
    ["Alta", date.format(c.createdAt)],
  ];

  const kpis: [string, string][] = [
    ["Total comprado", money.format(c.stats.totalPurchased)],
    ["Pedidos", String(c.stats.ordersCount)],
    ["Ticket promedio", money.format(c.stats.avgTicket)],
    ["Última compra", c.lastPurchaseAt ? date.format(c.lastPurchaseAt) : "—"],
    ["Último contacto", c.lastContactAt ? dateTime.format(c.lastContactAt) : "—"],
  ];

  return (
    <PageBody>
      <Link href="/clientes" className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Clientes
      </Link>

      {c.archived && (
        <p role="status" className="rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-700">
          Este cliente está dado de baja{c.archivedAt ? ` desde el ${date.format(c.archivedAt)}` : ""}. Su historial se conserva.
        </p>
      )}

      <header className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-4 sm:p-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-full bg-brand-100 text-lg font-semibold text-brand-800" aria-hidden>
            {c.name.slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold">{c.name}</h1>
            {c.company && <p className="text-sm text-ink-muted">{c.company}</p>}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <StageBadge stage={c.stage} />
              {c.needsReactivation && <Badge tone="danger">Para reactivar</Badge>}
              {c.ownerId ? <Badge tone="brand">{lookups.members.get(c.ownerId) ?? "Responsable"}</Badge> : <Badge tone="warn">Sin asignar</Badge>}
              {c.tagIds.map((tid) => {
                const t = tagsById.get(tid);
                return t ? <TagChip key={tid} name={t.name} color={t.color} /> : null;
              })}
            </div>
          </div>
        </div>
        <CustomerActions
          customer={c}
          options={options}
          canEdit={canEdit}
          canArchive={can(session.role, "clientes", "eliminar", session.overrides)}
        />
      </header>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {kpis.map(([label, value]) => (
          <div key={label} className="rounded-xl border border-line bg-surface px-4 py-3">
            <dt className="text-xs text-ink-muted">{label}</dt>
            <dd className="mt-1 truncate text-lg font-semibold">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Section title="Próxima acción">
            {nextTask ? (
              <p className="flex items-start gap-2 text-sm">
                <CalendarClock className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden />
                <span>
                  <span className="font-medium">{dateTime.format(nextTask.dueAt)}</span> · {nextTask.type}
                  {nextTask.description ? ` — ${nextTask.description}` : ""}
                </span>
              </p>
            ) : nextOpportunity ? (
              <p className="text-sm">{nextOpportunity.nextAction}</p>
            ) : (
              <Empty>No hay acciones pendientes. Las tareas de seguimiento llegan en la Fase 6.</Empty>
            )}
          </Section>

          <Section title="Notas internas">
            <div className="space-y-4">
              {canNote && !c.archived && <NoteForm customerId={c.id} />}
              {notes.length === 0 ? (
                <Empty>Sin notas.</Empty>
              ) : (
                <ul className="space-y-3">
                  {notes.map((n) => (
                    <li key={n.id} className="rounded-lg bg-amber-50/60 px-3 py-2">
                      <p className="text-sm whitespace-pre-wrap">{n.text}</p>
                      <p className="mt-1 text-xs text-ink-muted">
                        {lookups.members.get(n.createdBy) ?? "Usuario"} · {dateTime.format(n.createdAt)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Section>

          <Section title="Historial">
            <ActivityTimeline items={activities} lookups={lookups} timezone={tz} />
          </Section>
        </div>

        <div className="space-y-6">
          <Section title="Datos del cliente">
            <dl className="space-y-2 text-sm">
              {facts.map(([label, value]) => (
                <div key={label} className="grid grid-cols-3 gap-2">
                  <dt className="text-ink-muted">{label}</dt>
                  <dd className="col-span-2 break-words">{value}</dd>
                </div>
              ))}
            </dl>
          </Section>

          <Section title="Contactos">
            <ContactsPanel customerId={c.id} contacts={contacts} canEdit={canEdit && !c.archived} />
          </Section>

          <Section title="Conversaciones">
            {conversations.length === 0 ? (
              <Empty>Sin conversaciones de WhatsApp todavía.</Empty>
            ) : (
              <ul className="space-y-2 text-sm">
                {conversations.map((cv) => (
                  <li key={cv.id}>
                    <Link href={`/inbox?c=${cv.id}`} className="-mx-2 flex items-start gap-2 rounded-lg px-2 py-1 hover:bg-canvas">
                      <MessageCircle className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden />
                      <span className="min-w-0">
                        <span className="block truncate">{cv.lastMessagePreview ?? "Conversación"}</span>
                        <span className="text-xs text-ink-muted">
                          {cv.lastMessageAt ? dateTime.format(cv.lastMessageAt) : ""} · {CONVERSATION_STATUS_LABELS[cv.status]}
                          {cv.unreadCount > 0 ? ` · ${cv.unreadCount} sin leer` : ""}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Pedidos">
            {orders.length === 0 ? (
              <Empty>Sin pedidos.</Empty>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {orders.map((o) => (
                  <li key={o.id} className="flex justify-between gap-2 py-1.5">
                    <span>#{o.number} · {o.status}</span>
                    <span className="font-medium">{money.format(o.total)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Tareas pendientes">
            {tasks.length === 0 ? (
              <Empty>Sin tareas pendientes.</Empty>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {tasks.map((t) => (
                  <li key={t.id}>
                    <span className="font-medium">{dateTime.format(t.dueAt)}</span> · {t.type}
                    {t.description ? ` — ${t.description}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Oportunidades">
            {opportunities.length === 0 ? (
              <Empty>Sin oportunidades.</Empty>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {opportunities.map((o) => (
                  <li key={o.id} className="flex justify-between gap-2">
                    <span className="truncate">{o.product ?? "Oportunidad"}</span>
                    <span className="font-medium">{money.format(o.estimatedValue)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </PageBody>
  );
}
