import Link from "next/link";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Info, Minus } from "lucide-react";
import type { Kpi } from "@/server/dashboard/service";

/** Cómo se compara contra el período anterior y si subir es bueno o malo. */
export type Compare = { mode: "relativo" | "puntos"; better: "up" | "down" } | null;

export function deltaOf(k: Kpi, compare: Compare): { text: string; direction: "up" | "down" | "flat"; good: boolean | null } | null {
  if (!compare || k.value === null || k.previous === null) return null;
  const diff = k.value - k.previous;
  let text: string;
  if (compare.mode === "puntos") {
    const pp = diff * 100;
    if (Math.abs(pp) < 0.05) return { text: "igual", direction: "flat", good: null };
    text = `${pp > 0 ? "+" : "−"}${Math.abs(pp).toLocaleString("es-AR", { maximumFractionDigits: 1 })} pp`;
  } else {
    if (k.previous === 0) return k.value === 0 ? { text: "igual", direction: "flat", good: null } : null;
    const pct = (diff / k.previous) * 100;
    if (Math.abs(pct) < 0.5) return { text: "igual", direction: "flat", good: null };
    text = `${pct > 0 ? "+" : "−"}${Math.abs(pct).toLocaleString("es-AR", { maximumFractionDigits: pct > -10 && pct < 10 ? 1 : 0 })}%`;
  }
  const direction = diff > 0 ? "up" : "down";
  return { text, direction, good: direction === compare.better };
}

function Delta({ k, compare }: { k: Kpi; compare: Compare }) {
  const d = deltaOf(k, compare);
  if (!compare) return null;
  if (!d) {
    // Desde cero no hay porcentaje que mostrar, pero sí hubo período anterior.
    const text = k.previous === 0 && k.value ? "En el período anterior: 0" : "Sin datos del período anterior";
    return <p className="mt-1 text-xs text-ink-muted">{text}</p>;
  }
  const Icon = d.direction === "up" ? ArrowUpRight : d.direction === "down" ? ArrowDownRight : Minus;
  const color = d.good === null ? "text-ink-muted" : d.good ? "text-delta-up" : "text-delta-down";
  return (
    <p className="mt-1 flex items-center gap-1 text-xs text-ink-muted">
      <span className={`inline-flex items-center gap-0.5 font-medium ${color}`}>
        <Icon className="size-3.5" aria-hidden />
        {d.text}
      </span>
      <span>vs. período anterior</span>
    </p>
  );
}

/** Ícono de ayuda con la definición de la métrica (al pasar el mouse o con el teclado). */
export function InfoTip({ text }: { text: string }) {
  return (
    <>
      <button type="button" className="peer rounded-full text-ink-muted/70 hover:text-ink-muted focus-visible:text-ink-muted" aria-label={`Qué mide: ${text}`}>
        <Info className="size-3.5" aria-hidden />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute inset-x-2 top-9 z-20 hidden rounded-lg bg-ink px-3 py-2 text-xs leading-snug font-normal text-surface shadow-lg peer-hover:block peer-focus-visible:block"
      >
        {text}
      </span>
    </>
  );
}

export function StatTile({
  label,
  value,
  k,
  compare = null,
  help,
  sub,
  href,
  now,
}: {
  label: string;
  value: string;
  k?: Kpi;
  compare?: Compare;
  help: string;
  sub?: string;
  href?: string;
  /** Foto del momento: no depende del período elegido. */
  now?: boolean;
}) {
  return (
    <div className="relative glass-card rounded-xl p-4">
      <div className="flex items-center gap-1.5">
        <p className="text-xs font-bold tracking-wide text-ink-muted uppercase">{label}</p>
        <InfoTip text={help} />
        {now && <span className="ml-auto rounded-full bg-canvas px-2 py-0.5 text-[11px] font-medium text-ink-muted">Ahora</span>}
      </div>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-ink-muted">{sub}</p>}
      {k && <Delta k={k} compare={compare} />}
      {href && (
        <Link href={href} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
          Ver <ArrowRight className="size-3" aria-hidden />
        </Link>
      )}
    </div>
  );
}

/** La cifra principal del dashboard (una sola por vista). */
export function HeroStat({ label, value, k, help, sub }: { label: string; value: string; k: Kpi; help: string; sub?: string }) {
  return (
    <div className="relative">
      <div className="flex items-center gap-1.5">
        <p className="text-xs font-bold tracking-wide text-ink-muted uppercase">{label}</p>
        <InfoTip text={help} />
      </div>
      <p className="mt-1 text-4xl font-extrabold tracking-tight break-words sm:text-5xl">{value}</p>
      {sub && <p className="mt-1 text-sm text-ink-muted">{sub}</p>}
      <Delta k={k} compare={{ mode: "relativo", better: "up" }} />
    </div>
  );
}

export function Card({ title, help, action, children, className = "" }: { title: string; help?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`relative glass-card rounded-xl ${className}`}>
      <header className="flex items-center gap-1.5 border-b border-line px-4 py-3">
        <h2 className="text-base font-bold">{title}</h2>
        {help && <InfoTip text={help} />}
        {action && <div className="ml-auto">{action}</div>}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-sm text-ink-muted">{children}</p>;
}

/**
 * Lista de barras horizontales de una sola serie: cada fila lleva su valor
 * escrito, así que no hace falta pasar el mouse para leerla.
 */
export function BarList({ rows, emptyText = "Sin datos en el período" }: { rows: { key: string; label: React.ReactNode; value: number; display: string; sub?: string }[]; emptyText?: string }) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  if (!rows.length || max === 0) return <Empty>{emptyText}</Empty>;
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate">{r.label}</span>
            <span className="shrink-0 font-medium tabular-nums">
              {r.display}
              {r.sub && <span className="ml-1.5 text-xs font-normal text-ink-muted">{r.sub}</span>}
            </span>
          </div>
          <div className="mt-1.5 h-2 rounded-full bg-canvas">
            {r.value > 0 && <div className="h-2 rounded-full bg-brand-500" style={{ width: `${Math.max(1.5, (r.value / max) * 100)}%` }} />}
          </div>
        </li>
      ))}
    </ul>
  );
}

const SEGMENT_COLORS = ["bg-series-1", "bg-series-2", "bg-series-3"] as const;
const SEGMENT_TEXT = ["text-white", "text-white", "text-white"] as const;

/** Un total partido en partes (barra segmentada alta, con leyenda y valores). */
export function SegmentedBar({ parts, unit }: { parts: { key: string; label: string; value: number }[]; unit: (n: number) => string }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (!total) return <Empty>Nadie compró en el período</Empty>;
  const share = (v: number) => Math.round((v / total) * 100);
  return (
    <div>
      <div className="flex h-7 gap-0.5" role="img" aria-label={parts.map((p) => `${p.label}: ${unit(p.value)} (${share(p.value)}%)`).join(", ")}>
        {parts.map((p, i) =>
          p.value > 0 ? (
            <div
              key={p.key}
              className={`flex min-w-0 items-center rounded px-2 text-xs font-medium ${SEGMENT_COLORS[i]} ${SEGMENT_TEXT[i]}`}
              style={{ width: `${(p.value / total) * 100}%` }}
              title={`${p.label}: ${unit(p.value)} (${share(p.value)}%)`}
            >
              {/* Solo si entra; si no, el número queda en la leyenda. */}
              {(p.value / total) * 100 >= 12 && <span className="truncate">{share(p.value)}%</span>}
            </div>
          ) : null,
        )}
      </div>
      <ul className="mt-4 space-y-2 text-sm">
        {parts.map((p, i) => (
          <li key={p.key} className="flex items-center gap-2">
            <span className={`size-2.5 shrink-0 rounded-sm ${SEGMENT_COLORS[i]}`} aria-hidden />
            <span className="text-ink-muted">{p.label}</span>
            <span className="ml-auto font-medium tabular-nums">
              {unit(p.value)} <span className="text-xs font-normal text-ink-muted">({share(p.value)}%)</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
