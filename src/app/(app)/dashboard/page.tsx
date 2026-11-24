import type { Metadata } from "next";
import Link from "next/link";
import { requireAccess } from "@/server/auth/guards";
import { ApiError } from "@/server/api/handler";
import { can } from "@/server/permissions/matrix";
import { getDashboard, getDashboardOptions, type DashboardData } from "@/server/dashboard/service";
import { dashboardQuery, type DashboardQuery } from "@/lib/schemas";
import { formatMinutes } from "@/lib/metrics";
import { msToZoned } from "@/lib/tasks";
import { CONVERSATION_STATUS_LABELS, CUSTOMER_KIND_LABELS, LEAD_STATUS_LABELS } from "@/types/model";
import { PageBody, PageHeader } from "@/components/ui/page";
import { Alert } from "@/components/ui/controls";
import { DashboardFrame } from "./dashboard-frame";
import { ColumnChart } from "./column-chart";
import { BarList, Card, Empty, HeroStat, SegmentedBar, StatTile } from "./widgets";

export const metadata: Metadata = { title: "Dashboard" };

/** "05/11" (o "05/11/25" si es de otro año que el actual). */
const dayLabel = (d: string, year: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}${d.slice(0, 4) !== year ? `/${d.slice(2, 4)}` : ""}`;
const rangeLabel = (a: string, b: string, year: string) => (a === b ? dayLabel(a, year) : `${dayLabel(a, year)} al ${dayLabel(b, year)}`);
const pct = (n: number | null) => (n === null ? "—" : `${(n * 100).toLocaleString("es-AR", { maximumFractionDigits: 1 })}%`);
const count = (n: number | null) => (n === null ? "—" : n.toLocaleString("es-AR"));

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const session = await requireAccess("dashboard");
  const raw = await searchParams;
  const parsed = dashboardQuery.safeParse(Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === "string" && v)));
  const query: DashboardQuery = parsed.success ? parsed.data : { periodo: "30d" };

  const options = await getDashboardOptions(session);
  let data: DashboardData | null = null;
  let error: string | null = parsed.success ? null : "Los filtros de la dirección no son válidos: se muestran los últimos 30 días.";
  try {
    data = await getDashboard(session, query);
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    error = e.message;
  }

  const seesCustomers = can(session.role, "clientes", "ver", session.overrides);
  const seesInbox = can(session.role, "inbox", "ver", session.overrides);
  const year = data ? msToZoned(data.generatedAt, data.timezone).date.slice(0, 4) : "";
  const sellerName = options.sellers.find((s) => s.id === query.vendedor)?.name;
  const teamName = options.teams.find((t) => t.id === query.equipo)?.name;
  const scopeText =
    data?.scope === "propio"
      ? "Tus resultados"
      : sellerName
        ? `Resultados de ${sellerName}${teamName ? ` (${teamName})` : ""}`
        : teamName
          ? `Resultados de ${teamName}`
          : data?.scope === "equipo"
            ? "Resultados de tu equipo"
            : "Resultados de toda la empresa";

  return (
    <PageBody>
      <PageHeader
        title="Dashboard"
        description={data ? `${scopeText} · ${data.period.label.toLowerCase()} (${rangeLabel(data.period.firstDay, data.period.lastDay, year)})` : scopeText}
      />
      <DashboardFrame
        key={JSON.stringify(query)}
        filters={query}
        sellers={options.sellers}
        teams={options.teams}
        comparison={data ? `Comparado con ${rangeLabel(data.period.previousFirstDay, data.period.previousLastDay, year)}${data.period.partial ? " (mismo tramo)" : ""}` : undefined}
      >
        {error && (
          <div className="mb-6">
            <Alert>{error}</Alert>
          </div>
        )}
        {data && <Content d={data} query={query} seesCustomers={seesCustomers} seesInbox={seesInbox} />}
      </DashboardFrame>
    </PageBody>
  );
}

function Content({ d, query, seesCustomers, seesInbox }: { d: DashboardData; query: DashboardQuery; seesCustomers: boolean; seesInbox: boolean }) {
  const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: d.currency, maximumFractionDigits: 0 });
  const fmtMoney = (n: number | null) => (n === null ? "—" : money.format(n));
  const filterHref = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [key, v] of Object.entries({ ...query, ...extra })) if (v) p.set(key, String(v));
    return `/dashboard?${p}`;
  };
  const ownerParam = query.vendedor ? `&owner=${query.vendedor}` : "";
  const k = d.kpis;
  const showSellers = d.scope !== "propio";
  const responseHelp = `Promedio entre el primer mensaje del lead y la primera respuesta del equipo${
    d.businessHours ? ", contando solo el horario de atención." : ". Configurá el horario de atención en Configuración → General para descontar noches y fines de semana."
  }`;
  return (
    <div className="space-y-6">
      {/* Ventas */}
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="relative glass-card rounded-xl p-4 sm:p-5 lg:col-span-2">
          <HeroStat
            label="Monto vendido"
            value={fmtMoney(k.revenue.value)}
            k={k.revenue}
            help="Suma de los pedidos confirmados en el período, por fecha de confirmación. Los cancelados no cuentan."
            sub={`${count(k.sales.value)} ${k.sales.value === 1 ? "venta" : "ventas"} · ticket promedio ${fmtMoney(k.avgTicket.value)}`}
          />
          <h2 className="mt-5 mb-3 text-sm font-semibold">Ventas por {d.period.bucket === "hora" ? "hora" : d.period.bucket === "dia" ? "día" : "mes"}</h2>
          <ColumnChart
            title="Monto vendido por fecha de confirmación"
            kind="importe"
            currency={d.currency}
            data={d.series.map((s) => ({ key: s.key, label: s.label, value: s.revenue, detail: `${s.sales} ${s.sales === 1 ? "venta" : "ventas"}` }))}
          />
        </section>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-1">
          <StatTile label="Ventas" value={count(k.sales.value)} k={k.sales} compare={{ mode: "relativo", better: "up" }} help="Pedidos confirmados en el período, sin contar los cancelados." />
          <StatTile label="Tasa de conversión" value={pct(k.conversion.value)} k={k.conversion} compare={{ mode: "puntos", better: "up" }} help="De los leads que entraron en el período, qué porcentaje llegó a generar un pedido." />
          <StatTile label="Ticket promedio" value={fmtMoney(k.avgTicket.value)} k={k.avgTicket} compare={{ mode: "relativo", better: "up" }} help="Monto vendido dividido por la cantidad de ventas." />
          <StatTile
            label="Pedidos cargados"
            value={count(k.ordersCreated.value)}
            k={k.ordersCreated}
            compare={{ mode: "relativo", better: "up" }}
            help="Pedidos creados en el período en cualquier estado (incluye borradores y cancelados)."
          />
        </div>
      </div>

      {/* Leads */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Nuevos leads" value={count(k.leadsNew.value)} k={k.leadsNew} compare={{ mode: "relativo", better: "up" }} help="Contactos que escribieron por primera vez en el período." />
        <StatTile
          label="Leads atendidos"
          value={count(k.leadsAttended.value)}
          sub={k.leadsNew.value ? `${pct((k.leadsAttended.value ?? 0) / k.leadsNew.value)} de los nuevos` : undefined}
          help="Leads del período que ya recibieron una respuesta del equipo."
        />
        <StatTile
          label="Leads sin responder"
          value={count(k.leadsUnanswered.value)}
          help="Leads del período a los que nadie contestó todavía (los perdidos no cuentan)."
          href={seesInbox && k.leadsUnanswered.value ? "/inbox?f=no_respondidos" : undefined}
        />
        <StatTile
          label="Tiempo de respuesta"
          value={formatMinutes(k.responseAvg.value)}
          sub={k.responseMedian.value !== null ? `Mediana: ${formatMinutes(k.responseMedian.value)}` : undefined}
          k={k.responseAvg}
          compare={{ mode: "relativo", better: "down" }}
          help={responseHelp}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={`Leads por ${d.period.bucket === "hora" ? "hora" : d.period.bucket === "dia" ? "día" : "mes"}`} help="Leads nuevos según el momento en que escribieron por primera vez.">
          <ColumnChart title="Leads nuevos por fecha" kind="cantidad" data={d.series.map((s) => ({ key: s.key, label: s.label, value: s.leads }))} />
        </Card>
        <Card title="Conversión de leads" help="Hasta qué paso llegaron los leads que entraron en el período (aunque después se hayan perdido).">
          <BarList
            emptyText="No entraron leads en el período"
            rows={d.leadFunnel.map((f, i) => ({
              key: f.status,
              label: LEAD_STATUS_LABELS[f.status],
              value: f.count,
              display: count(f.count),
              sub: i > 0 && d.leadFunnel[0].count ? pct(f.count / d.leadFunnel[0].count) : undefined,
            }))}
          />
        </Card>
      </div>

      {/* Clientes */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="grid grid-cols-2 gap-4 lg:col-span-2">
          <StatTile label="Clientes nuevos" value={count(k.customersNew.value)} k={k.customersNew} compare={{ mode: "relativo", better: "up" }} help="Clientes que hicieron su primera compra en el período." />
          <StatTile
            label="Clientes reactivados"
            value={count(k.customersReactivated.value)}
            k={k.customersReactivated}
            compare={{ mode: "relativo", better: "up" }}
            help="Clientes inactivos, perdidos o marcados para reactivar que volvieron a comprar en el período."
          />
          <StatTile
            label="Para reactivar"
            value={count(d.now.toReactivate)}
            now
            help="Clientes marcados para reactivar en este momento (a mano o por la automatización de días sin compra)."
            href={seesCustomers && d.now.toReactivate ? `/clientes?reactivar=1${ownerParam}` : undefined}
          />
          <StatTile
            label="Clientes perdidos"
            value={count(d.now.lost)}
            now
            help="Clientes en la etapa Cliente perdido en este momento."
            href={seesCustomers && d.now.lost ? `/clientes?stage=cliente_perdido${ownerParam}` : undefined}
          />
        </div>
        <Card title="Clientes nuevos vs. recurrentes" help="Clientes distintos que compraron en el período, según si fue su primera compra, si volvieron después de estar inactivos o si compran seguido.">
          <SegmentedBar
            unit={count}
            parts={(["nuevo", "recurrente", "reactivado"] as const).map((kind) => ({ key: kind, label: CUSTOMER_KIND_LABELS[kind], value: d.buyers[kind] }))}
          />
        </Card>
      </div>

      {/* Equipo y pipeline */}
      <div className="grid gap-4 lg:grid-cols-2">
        {showSellers && (
          <Card title="Rendimiento por vendedor" help="Monto vendido por cada vendedor en el período (pedidos confirmados).">
            <BarList
              emptyText="Sin ventas en el período"
              rows={d.sellers.map((s) => ({ key: s.id, label: s.name, value: s.revenue, display: fmtMoney(s.revenue), sub: `${s.sales} ${s.sales === 1 ? "venta" : "ventas"}` }))}
            />
          </Card>
        )}
        <Card title="Embudo comercial" help="Oportunidades abiertas en cada etapa del pipeline en este momento, con su valor estimado. Abajo, las cerradas en el período.">
          <BarList
            emptyText="No hay oportunidades abiertas"
            rows={d.pipeline.open.map((s) => ({ key: s.stageId, label: s.name, value: s.value, display: fmtMoney(s.value), sub: `${s.count} op.` }))}
          />
          <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-3 text-sm">
            <div>
              <dt className="text-xs text-ink-muted">Ganadas en el período</dt>
              <dd className="font-medium">
                {count(d.pipeline.won.count)} <span className="text-xs font-normal text-ink-muted">· {fmtMoney(d.pipeline.won.value)}</span>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">Perdidas en el período</dt>
              <dd className="font-medium">
                {count(d.pipeline.lost.count)} <span className="text-xs font-normal text-ink-muted">· {fmtMoney(d.pipeline.lost.value)}</span>
              </dd>
            </div>
          </dl>
        </Card>
        <Card title="Conversaciones" help="Estado actual de las conversaciones abiertas y cuántas se cerraron en el período." className={showSellers ? "lg:col-span-2" : ""}>
          <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <dl className="grid grid-cols-3 gap-3 md:grid-cols-1">
              <div>
                <dt className="text-xs text-ink-muted">Abiertas ahora</dt>
                <dd className="text-xl font-semibold">{count(d.now.conversationsOpen)}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-muted">Esperando respuesta</dt>
                <dd className="text-xl font-semibold">
                  {seesInbox && d.now.conversationsWaiting ? (
                    <Link href="/inbox?f=no_respondidos" className="hover:underline">
                      {count(d.now.conversationsWaiting)}
                    </Link>
                  ) : (
                    count(d.now.conversationsWaiting)
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ink-muted">Cerradas en el período</dt>
                <dd className="text-xl font-semibold">{count(k.conversationsClosed.value)}</dd>
              </div>
            </dl>
            <BarList
              emptyText="No hay conversaciones abiertas"
              rows={d.now.conversationsByStatus.map((c) => ({ key: c.status, label: CONVERSATION_STATUS_LABELS[c.status], value: c.count, display: count(c.count) }))}
            />
          </div>
        </Card>
      </div>

      {/* Tabla por vendedor */}
      {showSellers && (
        <Card title="Detalle por vendedor" help="Leads asignados, atención y ventas de cada vendedor en el período. Tocá un nombre para ver el dashboard de esa persona.">
          {d.sellers.length === 0 ? (
            <Empty>No hay vendedores con datos en el período</Empty>
          ) : (
            <div className="-mx-4 overflow-x-auto">
              <table className="w-full min-w-[56rem] text-left text-sm">
                <thead className="border-b border-line text-xs text-ink-muted">
                  <tr>
                    <th className="px-4 py-2 font-medium">Vendedor</th>
                    <th className="px-3 py-2 text-right font-medium">Leads</th>
                    <th className="px-3 py-2 text-right font-medium">Atendidos</th>
                    <th className="px-3 py-2 text-right font-medium">Sin responder</th>
                    <th className="px-3 py-2 text-right font-medium">T. respuesta</th>
                    <th className="px-3 py-2 text-right font-medium">Conversión</th>
                    <th className="px-3 py-2 text-right font-medium">Pedidos</th>
                    <th className="px-3 py-2 text-right font-medium">Ventas</th>
                    <th className="px-3 py-2 text-right font-medium">Monto</th>
                    <th className="px-4 py-2 text-right font-medium">Ticket prom.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line tabular-nums">
                  {d.sellers.map((s) => (
                    <tr key={s.id} className="hover:bg-canvas/60">
                      <td className="px-4 py-2.5 font-medium">
                        <Link href={filterHref({ vendedor: s.id, equipo: undefined })} className="hover:underline">
                          {s.name}
                        </Link>
                        {!s.active && <span className="ml-1.5 text-xs font-normal text-ink-muted">(baja)</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right">{count(s.leads)}</td>
                      <td className="px-3 py-2.5 text-right">{count(s.attended)}</td>
                      <td className={`px-3 py-2.5 text-right ${s.unanswered ? "font-medium text-delta-down" : ""}`}>{count(s.unanswered)}</td>
                      <td className="px-3 py-2.5 text-right">{formatMinutes(s.responseAvg)}</td>
                      <td className="px-3 py-2.5 text-right">{pct(s.conversion)}</td>
                      <td className="px-3 py-2.5 text-right">{count(s.orders)}</td>
                      <td className="px-3 py-2.5 text-right">{count(s.sales)}</td>
                      <td className="px-3 py-2.5 text-right font-medium">{fmtMoney(s.revenue)}</td>
                      <td className="px-4 py-2.5 text-right">{fmtMoney(s.avgTicket)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {d.unassignedLeads > 0 && (
            <p className="mt-3 text-xs text-ink-muted">
              Además, {d.unassignedLeads} {d.unassignedLeads === 1 ? "lead del período no tiene" : "leads del período no tienen"} vendedor asignado.
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
