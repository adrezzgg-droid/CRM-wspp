"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { PERIOD_LABELS, PERIOD_PRESETS, type PeriodPreset } from "@/lib/metrics";
import { inputClass } from "@/components/ui/styles";

export interface DashboardFilterValues {
  periodo: PeriodPreset;
  desde?: string;
  hasta?: string;
  vendedor?: string;
  equipo?: string;
}

/**
 * Filtros del dashboard (una sola fila, arriba de todo) y el contenido que
 * filtran. Los filtros viven en la URL: se pueden compartir y el botón
 * "atrás" funciona. Mientras recarga, el contenido anterior queda atenuado.
 */
export function DashboardFrame({
  filters,
  sellers,
  teams,
  comparison,
  children,
}: {
  filters: DashboardFilterValues;
  sellers: { id: string; name: string }[];
  teams: { id: string; name: string }[];
  /** Texto del período comparado, p.ej. "Comparado con 21/09 al 20/10". */
  comparison?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [custom, setCustom] = useState({ desde: filters.desde ?? "", hasta: filters.hasta ?? "" });
  const [preset, setPreset] = useState<PeriodPreset>(filters.periodo);

  function go(next: Partial<DashboardFilterValues>) {
    const merged = { ...filters, ...next };
    const params = new URLSearchParams();
    params.set("periodo", merged.periodo);
    if (merged.periodo === "personalizado") {
      if (merged.desde) params.set("desde", merged.desde);
      if (merged.hasta) params.set("hasta", merged.hasta);
    }
    if (merged.vendedor) params.set("vendedor", merged.vendedor);
    if (merged.equipo) params.set("equipo", merged.equipo);
    startTransition(() => router.push(`${pathname}?${params}`, { scroll: false }));
  }

  function onPreset(value: PeriodPreset) {
    setPreset(value);
    // El rango personalizado espera a que se elijan las dos fechas.
    if (value !== "personalizado") go({ periodo: value, desde: undefined, hasta: undefined });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-2">
        <label className="w-full sm:w-auto">
          <span className="mb-1 block text-xs font-medium text-ink-muted">Período</span>
          <select value={preset} onChange={(e) => onPreset(e.target.value as PeriodPreset)} className={`${inputClass} sm:w-48`}>
            {PERIOD_PRESETS.map((p) => (
              <option key={p} value={p}>
                {PERIOD_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
        {preset === "personalizado" && (
          <form
            className="flex w-full flex-wrap items-end gap-2 sm:w-auto"
            onSubmit={(e) => {
              e.preventDefault();
              go({ periodo: "personalizado", desde: custom.desde, hasta: custom.hasta });
            }}
          >
            <label className="min-w-0 flex-1 sm:flex-none">
              <span className="mb-1 block text-xs font-medium text-ink-muted">Desde</span>
              <input type="date" required value={custom.desde} max={custom.hasta || undefined} onChange={(e) => setCustom((c) => ({ ...c, desde: e.target.value }))} className={inputClass} />
            </label>
            <label className="min-w-0 flex-1 sm:flex-none">
              <span className="mb-1 block text-xs font-medium text-ink-muted">Hasta</span>
              <input type="date" required value={custom.hasta} min={custom.desde || undefined} onChange={(e) => setCustom((c) => ({ ...c, hasta: e.target.value }))} className={inputClass} />
            </label>
            <button type="submit" className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
              Aplicar
            </button>
          </form>
        )}
        {sellers.length > 0 && (
          <label className="min-w-36 flex-1 sm:flex-none">
            <span className="mb-1 block text-xs font-medium text-ink-muted">Vendedor</span>
            <select value={filters.vendedor ?? ""} onChange={(e) => go({ vendedor: e.target.value || undefined })} className={`${inputClass} sm:w-48`}>
              <option value="">Todos</option>
              {sellers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {teams.length > 0 && (
          <label className="min-w-36 flex-1 sm:flex-none">
            <span className="mb-1 block text-xs font-medium text-ink-muted">Equipo</span>
            <select value={filters.equipo ?? ""} onChange={(e) => go({ equipo: e.target.value || undefined })} className={`${inputClass} sm:w-44`}>
              <option value="">Todos</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <p className="flex w-full items-center gap-1.5 text-xs text-ink-muted sm:ml-auto sm:min-h-9 sm:w-auto" aria-live="polite">
          {pending ? (
            <>
              <Loader2 className="size-3.5 animate-spin" aria-hidden /> Actualizando…
            </>
          ) : (
            comparison
          )}
        </p>
      </div>
      <div className={`transition-opacity ${pending ? "pointer-events-none opacity-50" : ""}`} aria-busy={pending}>
        {children}
      </div>
    </div>
  );
}
