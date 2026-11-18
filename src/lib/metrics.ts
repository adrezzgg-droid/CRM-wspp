/**
 * Métricas del dashboard. Código puro: períodos en la zona horaria de la
 * empresa, tiempo de respuesta dentro del horario de atención y agregados.
 * El servidor lee los documentos y esto los cuenta (mismo cálculo en las
 * pruebas que en producción).
 */
import type { CustomerKind, Lead, LeadStatus, Order } from "../types/model.ts";
import { msToZoned, zonedTimeToMs } from "./tasks.ts";

// ───────────────────────────── Períodos ─────────────────────────────────────

export const PERIOD_PRESETS = ["hoy", "ayer", "7d", "30d", "mes", "mes_anterior", "personalizado"] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export const PERIOD_LABELS: Record<PeriodPreset, string> = {
  hoy: "Hoy",
  ayer: "Ayer",
  "7d": "Últimos 7 días",
  "30d": "Últimos 30 días",
  mes: "Mes actual",
  mes_anterior: "Mes anterior",
  personalizado: "Rango personalizado",
};

/** Un rango personalizado no puede pasar de un año (costo de lectura acotado). */
export const MAX_PERIOD_DAYS = 366;

/** Agrupación de los gráficos: por hora (un día), por día (hasta 2 meses) o por mes. */
export type Bucket = "hora" | "dia" | "mes";

export interface DayRange {
  /** Inicio (inclusive), epoch ms. */
  from: number;
  /** Fin (exclusivo), epoch ms. */
  to: number;
  /** Primer y último día (AAAA-MM-DD) en la zona de la empresa, inclusive. */
  firstDay: string;
  lastDay: string;
}

export interface Period extends DayRange {
  preset: PeriodPreset;
  days: number;
  bucket: Bucket;
  /** El período incluye el momento actual (todavía no terminó). */
  partial: boolean;
  /**
   * Período anterior de igual duración. Si el actual está en curso, se corta
   * en el mismo tramo transcurrido: "hoy hasta las 11" contra "ayer hasta las 11".
   */
  previous: DayRange;
}

export class PeriodError extends Error {}

const pad = (n: number) => String(n).padStart(2, "0");
const utcDay = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
const fmtUtc = (t: Date) => `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;

export function addDays(date: string, n: number): string {
  return fmtUtc(new Date(utcDay(date) + n * 86_400_000));
}

function monthStart(date: string, offset = 0): string {
  const [y, m] = date.split("-").map(Number);
  return fmtUtc(new Date(Date.UTC(y, m - 1 + offset, 1)));
}

/** Cantidad de días entre dos fechas, ambas incluidas. */
export function daysBetween(first: string, last: string): number {
  return Math.round((utcDay(last) - utcDay(first)) / 86_400_000) + 1;
}

const isRealDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && addDays(date, 0) === date;

function dayRange(firstDay: string, lastDay: string, timeZone: string): DayRange {
  return {
    from: zonedTimeToMs(firstDay, "00:00", timeZone),
    to: zonedTimeToMs(addDays(lastDay, 1), "00:00", timeZone),
    firstDay,
    lastDay,
  };
}

export function resolvePeriod(
  preset: PeriodPreset,
  now: number,
  timeZone: string,
  custom: { desde?: string; hasta?: string } = {},
): Period {
  const today = msToZoned(now, timeZone).date;
  let first: string;
  let last: string;
  let prevFirst: string;
  let prevLast: string;
  switch (preset) {
    case "hoy":
      first = last = today;
      prevFirst = prevLast = addDays(today, -1);
      break;
    case "ayer":
      first = last = addDays(today, -1);
      prevFirst = prevLast = addDays(today, -2);
      break;
    case "7d":
    case "30d": {
      const n = preset === "7d" ? 7 : 30;
      last = today;
      first = addDays(today, -(n - 1));
      prevLast = addDays(first, -1);
      prevFirst = addDays(first, -n);
      break;
    }
    case "mes":
      first = monthStart(today);
      last = addDays(monthStart(today, 1), -1);
      prevFirst = monthStart(today, -1);
      prevLast = addDays(first, -1);
      break;
    case "mes_anterior":
      first = monthStart(today, -1);
      last = addDays(monthStart(today), -1);
      prevFirst = monthStart(today, -2);
      prevLast = addDays(first, -1);
      break;
    case "personalizado": {
      if (!custom.desde || !custom.hasta) throw new PeriodError("Elegí la fecha de inicio y la de fin del rango");
      if (!isRealDate(custom.desde) || !isRealDate(custom.hasta)) throw new PeriodError("Alguna de las fechas no existe");
      first = custom.desde;
      last = custom.hasta;
      if (first > last) throw new PeriodError("La fecha de inicio tiene que ser anterior a la de fin");
      const n = daysBetween(first, last);
      if (n > MAX_PERIOD_DAYS) throw new PeriodError(`El rango puede tener como máximo ${MAX_PERIOD_DAYS} días`);
      prevLast = addDays(first, -1);
      prevFirst = addDays(first, -n);
      break;
    }
  }
  const current = dayRange(first, last, timeZone);
  const previous = dayRange(prevFirst, prevLast, timeZone);
  const partial = now >= current.from && now < current.to;
  if (partial) previous.to = Math.min(previous.to, previous.from + (now - current.from));
  const days = daysBetween(first, last);
  return { preset, ...current, days, bucket: days === 1 ? "hora" : days <= 62 ? "dia" : "mes", partial, previous };
}

/** ¿El instante cae dentro del rango? */
export const inRange = (r: Pick<DayRange, "from" | "to">, ms: number | undefined): ms is number =>
  ms !== undefined && ms >= r.from && ms < r.to;

// ───────────────────────────── Agrupación ───────────────────────────────────

/** Claves de los grupos del período, sin pasar del momento actual. */
export function bucketKeys(p: Period, now: number, timeZone: string): string[] {
  const today = msToZoned(now, timeZone).date;
  const lastDay = p.partial && today < p.lastDay ? today : p.lastDay;
  if (p.bucket === "hora") {
    const lastHour = p.partial ? Number(msToZoned(now, timeZone).time.slice(0, 2)) : 23;
    return Array.from({ length: lastHour + 1 }, (_, h) => pad(h));
  }
  const keys: string[] = [];
  for (let d = p.firstDay; d <= lastDay; d = addDays(d, 1)) {
    const key = p.bucket === "dia" ? d : d.slice(0, 7);
    if (keys.at(-1) !== key) keys.push(key);
  }
  return keys;
}

export function bucketOf(ms: number, bucket: Bucket, timeZone: string): string {
  const { date, time } = msToZoned(ms, timeZone);
  return bucket === "hora" ? time.slice(0, 2) : bucket === "dia" ? date : date.slice(0, 7);
}

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export function bucketLabel(key: string, bucket: Bucket): string {
  if (bucket === "hora") return `${key} h`;
  if (bucket === "dia") return `${key.slice(8, 10)}/${key.slice(5, 7)}`;
  return `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(2, 4)}`;
}

/** Suma por grupo, alineada con `keys`. */
export function seriesBy<T>(
  rows: readonly T[],
  at: (r: T) => number,
  keys: readonly string[],
  bucket: Bucket,
  timeZone: string,
  value: (r: T) => number = () => 1,
): number[] {
  const index = new Map(keys.map((k, i) => [k, i]));
  const out = keys.map(() => 0);
  for (const r of rows) {
    const i = index.get(bucketOf(at(r), bucket, timeZone));
    if (i !== undefined) out[i] += value(r);
  }
  return out;
}

// ─────────────────────────── Tiempo de respuesta ────────────────────────────

export interface BusinessHours {
  /** 0 = domingo … 6 = sábado */
  days: number[];
  from: string;
  to: string;
}

/**
 * Minutos entre `start` y `end` contando solo el horario de atención (si la
 * empresa lo configuró). Un mensaje del domingo respondido el lunes a las
 * 8:05 con apertura a las 8:00 cuenta 5 minutos.
 */
export function responseMinutes(start: number, end: number, hours: BusinessHours | null, timeZone: string): number {
  if (end <= start) return 0;
  if (!hours) return (end - start) / 60_000;
  const lastDay = msToZoned(end, timeZone).date;
  let total = 0;
  let day = msToZoned(start, timeZone).date;
  for (let i = 0; i <= MAX_PERIOD_DAYS && day <= lastDay; i++, day = addDays(day, 1)) {
    if (!hours.days.includes(new Date(utcDay(day)).getUTCDay())) continue;
    const open = zonedTimeToMs(day, hours.from, timeZone);
    const close = zonedTimeToMs(day, hours.to, timeZone);
    total += Math.max(0, Math.min(end, close) - Math.max(start, open));
  }
  return total / 60_000;
}

export function mean(xs: readonly number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

export function median(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** "menos de 1 min", "12 min", "1 h 20 min", "2 d 3 h". */
export function formatMinutes(min: number | null): string {
  if (min === null) return "—";
  if (min < 1) return "menos de 1 min";
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  if (m < 1440) {
    const h = Math.floor(m / 60);
    const rest = m % 60;
    return rest ? `${h} h ${rest} min` : `${h} h`;
  }
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  return h ? `${d} d ${h} h` : `${d} d`;
}

// ─────────────────────────────── Leads ──────────────────────────────────────

/** Pasos del recorrido del lead que muestra el embudo de conversión. */
export const LEAD_FUNNEL = ["recibido", "asignado", "contactado", "en_negociacion", "pedido_generado", "venta_realizada"] as const satisfies readonly LeadStatus[];
const CONVERTED_STEP = LEAD_FUNNEL.indexOf("pedido_generado");
const CONTACTED_STEP = LEAD_FUNNEL.indexOf("contactado");

export type LeadRow = Pick<Lead, "createdAt" | "ownerId" | "status" | "statusAt" | "firstResponseAt">;

/** Paso más avanzado al que llegó el lead (aunque después se haya perdido). */
export function leadReach(l: LeadRow): number {
  let reach = 0;
  LEAD_FUNNEL.forEach((s, i) => {
    if (l.status === s || l.statusAt?.[s] !== undefined) reach = i;
  });
  return l.firstResponseAt ? Math.max(reach, CONTACTED_STEP) : reach;
}

/** Convertido = el lead llegó a generar un pedido. */
export const isConverted = (l: LeadRow) => leadReach(l) >= CONVERTED_STEP;
/** Sin responder = nadie del equipo le contestó y sigue abierto. */
export const isUnanswered = (l: LeadRow) => !l.firstResponseAt && l.status !== "perdido" && l.status !== "cerrado";

export interface LeadSummary {
  total: number;
  attended: number;
  unanswered: number;
  converted: number;
  /** Convertidos / total (0..1); null si no hubo leads. */
  conversion: number | null;
  responseAvg: number | null;
  responseMedian: number | null;
  /** Cantidad que llegó a cada paso de LEAD_FUNNEL (acumulado). */
  funnel: number[];
}

export function summarizeLeads(leads: readonly LeadRow[], hours: BusinessHours | null, timeZone: string): LeadSummary {
  const times = leads.filter((l) => l.firstResponseAt).map((l) => responseMinutes(l.createdAt, l.firstResponseAt!, hours, timeZone));
  const reach = leads.map(leadReach);
  const converted = leads.filter(isConverted).length;
  return {
    total: leads.length,
    attended: times.length,
    unanswered: leads.filter(isUnanswered).length,
    converted,
    conversion: leads.length ? converted / leads.length : null,
    responseAvg: mean(times),
    responseMedian: median(times),
    funnel: LEAD_FUNNEL.map((_, i) => reach.filter((r) => r >= i).length),
  };
}

// ─────────────────────────────── Ventas ─────────────────────────────────────

/** Venta = pedido confirmado (cuenta mientras no se cancele). */
export type SaleRow = Pick<Order, "sellerId" | "customerId" | "total" | "customerKind"> & { confirmedAt: number };

export interface SalesSummary {
  count: number;
  revenue: number;
  avgTicket: number | null;
  /** Clientes distintos que compraron, según el tipo de compra. */
  buyers: Record<CustomerKind, number>;
}

const KIND_PRIORITY: CustomerKind[] = ["nuevo", "reactivado", "recurrente"];

export function summarizeSales(sales: readonly SaleRow[]): SalesSummary {
  const revenue = Math.round(sales.reduce((s, o) => s + o.total, 0) * 100) / 100;
  // Un cliente que en el período compró por primera vez y después repitió es "nuevo".
  const byCustomer = new Map<string, CustomerKind>();
  for (const o of sales) {
    const kind = o.customerKind ?? "recurrente";
    const prev = byCustomer.get(o.customerId);
    if (!prev || KIND_PRIORITY.indexOf(kind) < KIND_PRIORITY.indexOf(prev)) byCustomer.set(o.customerId, kind);
  }
  const buyers: Record<CustomerKind, number> = { nuevo: 0, recurrente: 0, reactivado: 0 };
  for (const kind of byCustomer.values()) buyers[kind] += 1;
  return { count: sales.length, revenue, avgTicket: sales.length ? Math.round((revenue / sales.length) * 100) / 100 : null, buyers };
}

// ─────────────────────────────── Ejes ───────────────────────────────────────

/** Marcas "redondas" para el eje Y (0, 5, 10… / 0, 2.000, 4.000…). */
export function niceTicks(max: number, count = 4): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  // Sin 2,5 en unidades chicas: los conteos van de a números enteros.
  const factors = mag >= 10 ? [1, 2, 2.5, 5, 10] : [1, 2, 5, 10];
  const step = Math.max(1, factors.map((f) => f * mag).find((s) => s >= raw) ?? 10 * mag);
  const top = Math.ceil(max / step) * step;
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => Math.round(i * step * 1e6) / 1e6);
}
