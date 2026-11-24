"use client";

import { useEffect, useId, useRef, useState } from "react";
import { niceTicks } from "@/lib/metrics";

export interface Column {
  key: string;
  label: string;
  value: number;
  /** Texto secundario del tooltip y de la tabla (p.ej. "3 ventas"). */
  detail?: string;
}

const compact = new Intl.NumberFormat("es-AR", { notation: "compact", maximumFractionDigits: 1 });

/**
 * Columnas de una sola serie (por hora, día o mes). El tooltip aparece al
 * pasar el mouse o al recorrer con las flechas del teclado; la tabla con
 * todos los valores queda abajo, desplegable.
 */
export function ColumnChart({
  data,
  kind,
  currency = "ARS",
  title,
  height = 180,
}: {
  data: Column[];
  /** Cantidades o importes (se formatean acá: una función no cruza de servidor a cliente). */
  kind: "cantidad" | "importe";
  currency?: string;
  /** Nombre del gráfico para lectores de pantalla y la tabla. */
  title: string;
  height?: number;
}) {
  const [active, setActive] = useState<number | null>(null);
  // Ancho real del gráfico: define cuántas fechas entran en el eje sin pisarse.
  const plotRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const format = (n: number) =>
    kind === "importe"
      ? new Intl.NumberFormat("es-AR", { style: "currency", currency, maximumFractionDigits: 0 }).format(n)
      : n.toLocaleString("es-AR");
  const tableId = useId();
  const max = Math.max(0, ...data.map((d) => d.value));
  const ticks = niceTicks(max);
  const top = ticks.at(-1)!;
  // Etiquetas del eje X espaciadas (una cada ~60 px), siempre la primera y la última.
  const slots = width ? Math.max(2, Math.floor(width / 60)) : 6;
  const every = Math.max(1, Math.ceil(data.length / slots));
  const showLabel = (i: number) => i === 0 || i === data.length - 1 || (i % every === 0 && data.length - 1 - i >= every * 0.75);
  const total = data.reduce((s, d) => s + d.value, 0);
  const current = active !== null ? data[active] : null;

  function onKey(e: React.KeyboardEvent) {
    if (!data.length) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const step = e.key === "ArrowRight" ? 1 : -1;
      setActive((a) => (a === null ? (step > 0 ? 0 : data.length - 1) : Math.min(data.length - 1, Math.max(0, a + step))));
    } else if (e.key === "Escape") setActive(null);
  }

  return (
    <div>
      <div className="flex gap-2">
        {/* Eje Y */}
        <div className="relative w-10 shrink-0 text-right text-[11px] text-ink-muted tabular-nums" style={{ height }} aria-hidden>
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: `${(1 - t / top) * 100}%` }}>
              {compact.format(t)}
            </span>
          ))}
        </div>
        <div ref={plotRef} className="min-w-0 flex-1">
          <div
            role="img"
            tabIndex={0}
            aria-label={`${title}. ${data.length} valores, total ${format(total)}. Usá las flechas para recorrerlos.`}
            onKeyDown={onKey}
            onBlur={() => setActive(null)}
            onPointerLeave={() => setActive(null)}
            className="relative rounded focus-visible:outline-offset-4"
            style={{ height }}
          >
            {/* Grilla */}
            {ticks.map((t) => (
              <div key={t} className={`absolute inset-x-0 h-px ${t === 0 ? "bg-viz-axis" : "bg-viz-grid"}`} style={{ top: `${(1 - t / top) * 100}%` }} aria-hidden />
            ))}
            {/* Columnas: el área de cada una es la franja entera (más fácil de apuntar que la barra). */}
            <div className="absolute inset-0 flex items-end gap-0.5">
              {data.map((d, i) => (
                <div key={d.key} className="flex h-full min-w-0 flex-1 items-end justify-center" onPointerEnter={() => setActive(i)}>
                  {d.value > 0 && (
                    <div
                      className={`w-full max-w-6 rounded-t transition-colors ${active === i ? "bg-brand-700" : "bg-brand-500"}`}
                      style={{ height: `${Math.max(1, (d.value / top) * 100)}%` }}
                    />
                  )}
                </div>
              ))}
            </div>
            {current && (
              <div
                className="pointer-events-none absolute -top-2 z-10 -translate-y-full rounded-lg bg-ink px-2.5 py-1.5 text-xs whitespace-nowrap text-surface shadow-lg"
                style={
                  active! < data.length / 2
                    ? { left: `${(active! / data.length) * 100}%` }
                    : { right: `${((data.length - active! - 1) / data.length) * 100}%` }
                }
              >
                <p className="text-sm font-semibold">{format(current.value)}</p>
                <p className="text-surface/75">
                  {current.label}
                  {current.detail ? ` · ${current.detail}` : ""}
                </p>
              </div>
            )}
          </div>
          {/* Eje X */}
          <div className="relative mt-1.5 h-4 text-[11px] text-ink-muted" aria-hidden>
            {data.map((d, i) =>
              showLabel(i) ? (
                <span
                  key={d.key}
                  className={`absolute whitespace-nowrap ${i === 0 ? "" : i === data.length - 1 ? "-translate-x-full" : "-translate-x-1/2"}`}
                  style={{ left: i === data.length - 1 ? "100%" : `${((i + 0.5) / data.length) * 100}%` }}
                >
                  {d.label}
                </span>
              ) : null,
            )}
          </div>
        </div>
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-xs font-medium text-brand-700 hover:underline" aria-controls={tableId}>
          Ver los datos
        </summary>
        <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-line">
          <table id={tableId} className="w-full text-left text-sm">
            <caption className="sr-only">{title}</caption>
            <thead className="sticky top-0 bg-canvas text-xs text-ink-muted">
              <tr>
                <th className="px-3 py-1.5 font-medium">Fecha</th>
                <th className="px-3 py-1.5 text-right font-medium">Valor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.map((d) => (
                <tr key={d.key}>
                  <td className="px-3 py-1.5">{d.label}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {format(d.value)}
                    {d.detail && <span className="ml-1.5 text-xs text-ink-muted">{d.detail}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
