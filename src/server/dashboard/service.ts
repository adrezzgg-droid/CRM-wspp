import "server-only";
import type { Query, QuerySnapshot } from "firebase-admin/firestore";
import type { Conversation, ConversationStatus, Customer, CustomerKind, Lead, Opportunity, Order } from "@/types/model";
import { orgPath } from "@/types/model";
import { adminDb } from "@/server/firebase/admin";
import { ApiError } from "@/server/api/handler";
import { can } from "@/server/permissions/matrix";
import { scopeAllows } from "@/server/permissions/scope";
import type { Session } from "@/server/auth/session";
import { getGeneralSettings, getMembers, getTeams, OWNER_ROLES, scopeContext } from "@/server/org/data";
import { getPipeline } from "@/server/commercial/common";
import { OPEN_STATUSES } from "@/lib/inbox-filters";
import type { DashboardQuery } from "@/lib/schemas";
import {
  bucketKeys,
  bucketLabel,
  inRange,
  LEAD_FUNNEL,
  PERIOD_LABELS,
  PeriodError,
  resolvePeriod,
  seriesBy,
  summarizeLeads,
  summarizeSales,
  type Bucket,
  type LeadRow,
  type Period,
  type SaleRow,
} from "@/lib/metrics";

/** Valor del período y del período anterior (null = no aplica o sin datos). */
export interface Kpi {
  value: number | null;
  previous: number | null;
}

export interface SellerRow {
  id: string;
  name: string;
  active: boolean;
  leads: number;
  attended: number;
  unanswered: number;
  responseAvg: number | null;
  conversion: number | null;
  orders: number;
  sales: number;
  revenue: number;
  avgTicket: number | null;
}

export interface DashboardData {
  generatedAt: number;
  currency: string;
  timezone: string;
  period: {
    preset: Period["preset"];
    label: string;
    firstDay: string;
    lastDay: string;
    previousFirstDay: string;
    previousLastDay: string;
    partial: boolean;
    bucket: Bucket;
  };
  /** Qué abarca: toda la empresa, el equipo del supervisor o lo propio. */
  scope: "todo" | "equipo" | "propio";
  /** El tiempo de respuesta descuenta lo que pasa fuera del horario de atención. */
  businessHours: boolean;
  kpis: {
    leadsNew: Kpi;
    leadsAttended: Kpi;
    leadsUnanswered: Kpi;
    responseAvg: Kpi;
    responseMedian: Kpi;
    conversion: Kpi;
    sales: Kpi;
    revenue: Kpi;
    avgTicket: Kpi;
    ordersCreated: Kpi;
    customersNew: Kpi;
    customersReactivated: Kpi;
    customersRecurring: Kpi;
    conversationsClosed: Kpi;
  };
  /** Fotos del momento (no dependen del período). */
  now: {
    conversationsOpen: number;
    conversationsWaiting: number;
    conversationsByStatus: { status: Exclude<ConversationStatus, "cerrada">; count: number }[];
    toReactivate: number;
    lost: number;
  };
  series: { key: string; label: string; leads: number; sales: number; revenue: number }[];
  leadFunnel: { status: (typeof LEAD_FUNNEL)[number]; count: number }[];
  pipeline: {
    open: { stageId: string; name: string; count: number; value: number; weighted: number }[];
    won: { count: number; value: number };
    lost: { count: number; value: number };
  };
  buyers: Record<CustomerKind, number>;
  sellers: SellerRow[];
  /** Leads del período que nadie tiene asignados (solo alcance todo/equipo sin filtro de vendedor). */
  unassignedLeads: number;
}

export interface DashboardOptions {
  sellers: { id: string; name: string }[];
  teams: { id: string; name: string }[];
}

const col = (orgId: string, c: Parameters<typeof orgPath>[1]) => adminDb().collection(orgPath(orgId, c));
const rows = <T,>(snap: QuerySnapshot) => snap.docs.map((d) => ({ ...(d.data() as T), id: d.id }));
const between = (q: Query, field: string, from: number, to: number) => q.where(field, ">=", from).where(field, "<", to);
const kpi = (value: number | null, previous: number | null): Kpi => ({ value, previous });

/** Vendedores y equipos que el usuario puede usar como filtro. */
export async function getDashboardOptions(session: Session): Promise<DashboardOptions> {
  const [ctx, members, teams] = await Promise.all([scopeContext(session, "dashboard"), getMembers(session.orgId), getTeams(session.orgId)]);
  if (ctx.scope === "propio" || !ctx.scope) return { sellers: [], teams: [] };
  return {
    sellers: members
      .filter((m) => OWNER_ROLES.has(m.role) && scopeAllows(ctx, m.id))
      .sort((a, b) => Number(b.active) - Number(a.active) || a.displayName.localeCompare(b.displayName))
      .map((m) => ({ id: m.id, name: m.active ? m.displayName : `${m.displayName} (baja)` })),
    teams: teams
      .filter((t) => ctx.scope === "todo" || t.leaderIds.includes(session.uid))
      .map((t) => ({ id: t.id, name: t.name })),
  };
}

/**
 * Dashboard comercial. Lee solo los documentos del período (con proyección de
 * campos) y cuenta en memoria: el alcance (propio / equipo / todo) y los
 * filtros de vendedor y equipo se aplican sobre el responsable de cada dato.
 */
export async function getDashboard(session: Session, q: DashboardQuery): Promise<DashboardData> {
  if (!can(session.role, "dashboard", "ver", session.overrides)) throw new ApiError(403, "No tenés permiso para ver el dashboard");
  const now = Date.now();
  const tz = session.org.timezone;
  let period: Period;
  try {
    period = resolvePeriod(q.periodo, now, tz, { desde: q.desde, hasta: q.hasta });
  } catch (error) {
    if (error instanceof PeriodError) throw new ApiError(422, error.message);
    throw error;
  }

  const [ctx, members, teams, general, pipeline] = await Promise.all([
    scopeContext(session, "dashboard"),
    getMembers(session.orgId),
    getTeams(session.orgId),
    getGeneralSettings(session.orgId),
    getPipeline(session.orgId),
  ]);
  const scope = ctx.scope ?? "propio";
  const options = await getDashboardOptions(session);
  if (q.vendedor && scope !== "propio" && !options.sellers.some((s) => s.id === q.vendedor)) throw new ApiError(404, "Vendedor no encontrado");
  if (q.equipo && !options.teams.some((t) => t.id === q.equipo)) throw new ApiError(404, "Equipo no encontrado");
  const team = q.equipo ? teams.find((t) => t.id === q.equipo) : undefined;
  const teamSet = team ? new Set([...team.leaderIds, ...team.memberIds]) : null;
  const seller = scope === "propio" ? undefined : q.vendedor;
  /** ¿El dato de este responsable entra en lo que se muestra? */
  const allow = (uid: string | null | undefined) =>
    scopeAllows(ctx, uid) && (!seller || uid === seller) && (!teamSet || (!!uid && teamSet.has(uid)));

  const org = session.orgId;
  const openStages = pipeline.stages.filter((s) => s.kind === "abierta");
  const [leadsSnap, salesSnap, createdSnap, openConvSnap, closedConvSnap, reactSnap, lostSnap, openOppSnap, closedOppSnap] = await Promise.all([
    // Leads del período y del anterior en una sola lectura (son contiguos).
    between(col(org, "leads"), "createdAt", period.previous.from, period.to).select("createdAt", "ownerId", "status", "statusAt", "firstResponseAt").get(),
    between(col(org, "orders"), "statusAt.confirmado", period.previous.from, period.to).select("sellerId", "customerId", "total", "counted", "customerKind", "statusAt").get(),
    between(col(org, "orders"), "createdAt", period.previous.from, period.to).select("sellerId", "createdAt").get(),
    col(org, "conversations").where("status", "in", OPEN_STATUSES).select("status", "assigneeId", "awaitingReply").get(),
    between(col(org, "conversations"), "closedAt", period.previous.from, period.to).select("assigneeId", "closedAt").get(),
    col(org, "customers").where("archived", "==", false).where("needsReactivation", "==", true).select("ownerId").get(),
    col(org, "customers").where("archived", "==", false).where("stage", "==", "cliente_perdido").select("ownerId").get(),
    openStages.length ? col(org, "opportunities").where("stageId", "in", openStages.map((s) => s.id)).select("ownerId", "stageId", "estimatedValue", "probability").get() : null,
    between(col(org, "opportunities"), "closedAt", period.from, period.to).select("ownerId", "stageId", "estimatedValue").get(),
  ]);

  const prev = period.previous;
  const leads = rows<Lead>(leadsSnap).filter((l) => allow(l.ownerId ?? null));
  const curLeads: LeadRow[] = leads.filter((l) => inRange(period, l.createdAt));
  const prevLeads: LeadRow[] = leads.filter((l) => inRange(prev, l.createdAt));
  const sales: SaleRow[] = rows<Order>(salesSnap)
    .filter((o) => o.counted && allow(o.sellerId))
    .map((o) => ({ sellerId: o.sellerId, customerId: o.customerId, total: o.total, customerKind: o.customerKind, confirmedAt: o.statusAt.confirmado! }));
  const curSales = sales.filter((o) => inRange(period, o.confirmedAt));
  const prevSales = sales.filter((o) => inRange(prev, o.confirmedAt));
  const created = rows<Order>(createdSnap).filter((o) => allow(o.sellerId));
  const curCreated = created.filter((o) => inRange(period, o.createdAt));
  const closedConvs = rows<Conversation>(closedConvSnap).filter((c) => allow(c.assigneeId));

  const L = summarizeLeads(curLeads, general.businessHours, tz);
  const Lp = summarizeLeads(prevLeads, general.businessHours, tz);
  const S = summarizeSales(curSales);
  const Sp = summarizeSales(prevSales);

  // Series por hora / día / mes.
  const keys = bucketKeys(period, now, tz);
  const leadsSeries = seriesBy(curLeads, (l) => l.createdAt, keys, period.bucket, tz);
  const salesSeries = seriesBy(curSales, (o) => o.confirmedAt, keys, period.bucket, tz);
  const revenueSeries = seriesBy(curSales, (o) => o.confirmedAt, keys, period.bucket, tz, (o) => o.total);

  // Fotos del momento.
  const openConvs = rows<Conversation>(openConvSnap).filter((c) => allow(c.assigneeId));
  const byStatus = (OPEN_STATUSES as Exclude<ConversationStatus, "cerrada">[]).map((status) => ({ status, count: openConvs.filter((c) => c.status === status).length }));

  // Pipeline: abiertas por etapa (foto) y cerradas en el período.
  const openOpps = openOppSnap ? rows<Opportunity>(openOppSnap).filter((o) => allow(o.ownerId)) : [];
  const closedOpps = rows<Opportunity>(closedOppSnap).filter((o) => allow(o.ownerId));
  const stageKind = new Map(pipeline.stages.map((s) => [s.id, s.kind]));
  const sum = (xs: Opportunity[]) => Math.round(xs.reduce((s, o) => s + o.estimatedValue, 0) * 100) / 100;
  const won = closedOpps.filter((o) => stageKind.get(o.stageId) === "ganada");
  const lostOpps = closedOpps.filter((o) => stageKind.get(o.stageId) === "perdida");

  // Por vendedor: todos los responsables visibles con datos o activos.
  const byOwner = <T,>(xs: readonly T[], owner: (x: T) => string | null | undefined) => {
    const m = new Map<string, T[]>();
    for (const x of xs) {
      const id = owner(x);
      if (!id) continue;
      m.set(id, [...(m.get(id) ?? []), x]);
    }
    return m;
  };
  const leadsBy = byOwner(curLeads, (l) => l.ownerId);
  const salesBy = byOwner(curSales, (o) => o.sellerId);
  const createdBy = byOwner(curCreated, (o) => o.sellerId);
  const sellers: SellerRow[] = members
    .filter((m) => OWNER_ROLES.has(m.role) && allow(m.id) && (m.active || leadsBy.has(m.id) || salesBy.has(m.id) || createdBy.has(m.id)))
    .map((m) => {
      const l = summarizeLeads(leadsBy.get(m.id) ?? [], general.businessHours, tz);
      const s = summarizeSales(salesBy.get(m.id) ?? []);
      return {
        id: m.id,
        name: m.displayName,
        active: m.active,
        leads: l.total,
        attended: l.attended,
        unanswered: l.unanswered,
        responseAvg: l.responseAvg,
        conversion: l.conversion,
        orders: createdBy.get(m.id)?.length ?? 0,
        sales: s.count,
        revenue: s.revenue,
        avgTicket: s.avgTicket,
      };
    })
    // Los que no tienen leads ni ventas (p.ej. un admin sin cartera) no suman ruido.
    .filter((r) => r.leads || r.orders || r.sales || members.find((m) => m.id === r.id)?.role === "vendedor")
    .sort((a, b) => b.revenue - a.revenue || b.leads - a.leads || a.name.localeCompare(b.name));

  const customersPrev = (kind: CustomerKind) => Sp.buyers[kind];
  return {
    generatedAt: now,
    currency: session.org.currency,
    timezone: tz,
    period: {
      preset: period.preset,
      label: PERIOD_LABELS[period.preset],
      firstDay: period.firstDay,
      lastDay: period.lastDay,
      previousFirstDay: prev.firstDay,
      previousLastDay: prev.lastDay,
      partial: period.partial,
      bucket: period.bucket,
    },
    scope,
    businessHours: !!general.businessHours,
    kpis: {
      leadsNew: kpi(L.total, Lp.total),
      leadsAttended: kpi(L.attended, Lp.attended),
      leadsUnanswered: kpi(L.unanswered, Lp.unanswered),
      responseAvg: kpi(L.responseAvg, Lp.responseAvg),
      responseMedian: kpi(L.responseMedian, Lp.responseMedian),
      conversion: kpi(L.conversion, Lp.conversion),
      sales: kpi(S.count, Sp.count),
      revenue: kpi(S.revenue, Sp.revenue),
      avgTicket: kpi(S.avgTicket, Sp.avgTicket),
      ordersCreated: kpi(curCreated.length, created.filter((o) => inRange(prev, o.createdAt)).length),
      customersNew: kpi(S.buyers.nuevo, customersPrev("nuevo")),
      customersReactivated: kpi(S.buyers.reactivado, customersPrev("reactivado")),
      customersRecurring: kpi(S.buyers.recurrente, customersPrev("recurrente")),
      conversationsClosed: kpi(closedConvs.filter((c) => inRange(period, c.closedAt)).length, closedConvs.filter((c) => inRange(prev, c.closedAt)).length),
    },
    now: {
      conversationsOpen: openConvs.length,
      conversationsWaiting: openConvs.filter((c) => c.awaitingReply).length,
      conversationsByStatus: byStatus,
      toReactivate: rows<Customer>(reactSnap).filter((c) => allow(c.ownerId)).length,
      lost: rows<Customer>(lostSnap).filter((c) => allow(c.ownerId)).length,
    },
    series: keys.map((key, i) => ({ key, label: bucketLabel(key, period.bucket), leads: leadsSeries[i], sales: salesSeries[i], revenue: Math.round(revenueSeries[i] * 100) / 100 })),
    leadFunnel: LEAD_FUNNEL.map((status, i) => ({ status, count: L.funnel[i] })),
    pipeline: {
      open: openStages.map((s) => {
        const xs = openOpps.filter((o) => o.stageId === s.id);
        return { stageId: s.id, name: s.name, count: xs.length, value: sum(xs), weighted: Math.round(xs.reduce((t, o) => t + (o.estimatedValue * o.probability) / 100, 0)) };
      }),
      won: { count: won.length, value: sum(won) },
      lost: { count: lostOpps.length, value: sum(lostOpps) },
    },
    buyers: S.buyers,
    sellers,
    unassignedLeads: seller || teamSet ? 0 : curLeads.filter((l) => !l.ownerId).length,
  };
}
