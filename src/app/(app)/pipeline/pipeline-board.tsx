"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, GripVertical, Plus } from "lucide-react";
import type { Opportunity, PipelineStage } from "@/types/model";
import { columnSummary, daysInStage } from "@/lib/pipeline";
import { api, errorMessage } from "@/lib/api-client";
import { useNow } from "@/lib/use-now";
import { Alert, Button, Field, inputClass, Modal } from "@/components/ui/controls";
import { OpportunityFormModal, type OpportunityFormOptions } from "@/components/commercial/opportunity-form";

const STALE_DAYS = 7;

/**
 * Tablero del pipeline. Se mueven oportunidades arrastrando (escritorio) o
 * con el selector "Mover a…" de cada tarjeta (teclado y celular). El cambio
 * se ve al instante y se revierte si el servidor lo rechaza.
 */
export function PipelineBoard({
  stages,
  initial,
  options,
  names,
  canCreate,
  canEdit,
}: {
  stages: PipelineStage[];
  initial: Opportunity[];
  options: OpportunityFormOptions;
  names: Record<string, string>;
  canCreate: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const now = useNow();
  // Movimiento optimista atado a la versión del dato: cuando llega la versión
  // nueva del servidor (otro updatedAt), deja de aplicarse sola.
  const [overrides, setOverrides] = useState<Record<string, { stageId: string; base: number }>>({});
  const [dragging, setDragging] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Opportunity | null>(null);
  const [creating, setCreating] = useState(false);
  const [losing, setLosing] = useState<{ opp: Opportunity; stageId: string } | null>(null);
  const [reason, setReason] = useState("");
  const money = useMemo(() => new Intl.NumberFormat("es-AR", { style: "currency", currency: options.currency, maximumFractionDigits: 0 }), [options.currency]);

  // Movimientos optimistas por encima de lo que vino del servidor.
  const pending = (o: Opportunity) => overrides[o.id] && overrides[o.id].base === o.updatedAt;
  const opps = initial.map((o) => (pending(o) ? { ...o, stageId: overrides[o.id].stageId } : o));
  const byStage = new Map(stages.map((s) => [s.id, opps.filter((o) => o.stageId === s.id)]));

  async function move(opp: Opportunity, stageId: string, lostReason?: string) {
    if (opp.stageId === stageId) return;
    const stage = stages.find((s) => s.id === stageId);
    if (stage?.kind === "perdida" && !lostReason) {
      setReason("");
      setLosing({ opp, stageId });
      return;
    }
    setError(null);
    const base = initial.find((x) => x.id === opp.id)?.updatedAt ?? opp.updatedAt;
    setOverrides((o) => ({ ...o, [opp.id]: { stageId, base } }));
    try {
      await api("PATCH", `/api/opportunities/${opp.id}`, { stageId, ...(lostReason ? { lostReason } : {}) });
      router.refresh();
    } catch (err) {
      setOverrides((o) => {
        const next = { ...o };
        delete next[opp.id];
        return next;
      });
      setError(errorMessage(err));
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {error ? <Alert>{error}</Alert> : <p className="text-xs text-ink-muted">{canEdit ? "Arrastrá las tarjetas entre columnas o usá “Mover a…”." : "Solo lectura."}</p>}
        {canCreate && (
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden /> Nueva oportunidad
          </Button>
        )}
      </div>

      <div className="-mx-4 flex min-h-0 flex-1 gap-3 overflow-x-auto px-4 pb-3 sm:-mx-6 sm:px-6" role="list" aria-label="Etapas del pipeline">
        {stages.map((s) => {
          const items = byStage.get(s.id) ?? [];
          const sum = columnSummary(items);
          const isOver = overStage === s.id && dragging;
          return (
            <section
              key={s.id}
              role="listitem"
              aria-label={`${s.name}: ${sum.count} oportunidades`}
              onDragOver={(e) => {
                if (!canEdit || !dragging) return;
                e.preventDefault();
                setOverStage(s.id);
              }}
              onDragLeave={() => setOverStage((cur) => (cur === s.id ? null : cur))}
              onDrop={(e) => {
                e.preventDefault();
                const opp = opps.find((o) => o.id === e.dataTransfer.getData("text/plain"));
                setOverStage(null);
                setDragging(null);
                if (opp) move(opp, s.id);
              }}
              className={`flex w-72 shrink-0 flex-col rounded-xl border bg-canvas transition ${isOver ? "border-brand-500 bg-brand-50" : "border-line"}`}
            >
              <header className={`rounded-t-xl border-b border-line px-3 py-2 ${s.kind === "ganada" ? "bg-green-50" : s.kind === "perdida" ? "bg-slate-100" : "bg-surface"}`}>
                <div className="flex items-center justify-between gap-2">
                  <h2 className="truncate text-sm font-semibold">{s.name}</h2>
                  <span className="rounded-full bg-canvas px-2 text-xs font-medium text-ink-muted">{sum.count}</span>
                </div>
                <p className="text-xs text-ink-muted">
                  {money.format(sum.total)}
                  {s.kind === "abierta" && sum.count > 0 && <> · ponderado {money.format(sum.weighted)}</>}
                </p>
              </header>
              <ul className="min-h-24 flex-1 space-y-2 overflow-y-auto p-2">
                {items.map((o) => {
                  const days = daysInStage(o.stageChangedAt, now);
                  const stale = s.kind === "abierta" && days >= STALE_DAYS;
                  return (
                    <li
                      key={o.id}
                      draggable={canEdit}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", o.id);
                        e.dataTransfer.effectAllowed = "move";
                        setDragging(o.id);
                      }}
                      onDragEnd={() => {
                        setDragging(null);
                        setOverStage(null);
                      }}
                      className={`rounded-lg border bg-surface p-3 shadow-sm ${dragging === o.id ? "opacity-50" : ""} ${canEdit ? "cursor-grab active:cursor-grabbing" : ""} ${pending(o) ? "border-brand-300" : "border-line"}`}
                    >
                      <div className="flex items-start gap-1.5">
                        {canEdit && <GripVertical className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden />}
                        <button type="button" onClick={() => setEditing(o)} className="min-w-0 flex-1 text-left">
                          <span className="block truncate text-sm font-medium hover:text-brand-700">{o.customerName}</span>
                          {o.product && <span className="block truncate text-xs text-ink-muted">{o.product}</span>}
                        </button>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                        <span className="font-semibold">{money.format(o.estimatedValue)}</span>
                        <span className="text-ink-muted">{o.probability}% · {names[o.ownerId]?.split(" ")[0] ?? "—"}</span>
                      </div>
                      {o.nextAction && s.kind === "abierta" && (
                        <p className="mt-1.5 flex items-start gap-1 text-xs text-ink-muted">
                          <CalendarClock className="mt-0.5 size-3 shrink-0" aria-hidden />
                          <span className="line-clamp-2">{o.nextAction}</span>
                        </p>
                      )}
                      {o.lostReason && s.kind === "perdida" && <p className="mt-1.5 text-xs text-ink-muted">Motivo: {o.lostReason}</p>}
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span className={`text-[11px] ${stale ? "font-semibold text-amber-700" : "text-ink-muted"}`} title={stale ? "Sin movimiento hace una semana o más" : undefined}>
                          {days === 0 ? "Hoy" : `${days} d en la etapa`}
                        </span>
                        {canEdit && (
                          <select
                            value=""
                            onChange={(e) => e.target.value && move(o, e.target.value)}
                            className="max-w-28 rounded border border-line bg-surface px-1 py-0.5 text-[11px] text-ink-muted"
                            aria-label={`Mover ${o.customerName} a otra etapa`}
                          >
                            <option value="">Mover a…</option>
                            {stages.filter((x) => x.id !== o.stageId).map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.name}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      {creating && <OpportunityFormModal open onClose={() => setCreating(false)} options={options} />}
      {editing && <OpportunityFormModal open onClose={() => setEditing(null)} options={options} opportunity={editing} />}
      <Modal
        open={!!losing}
        onClose={() => setLosing(null)}
        title="Oportunidad perdida"
        footer={
          <>
            <Button variant="secondary" onClick={() => setLosing(null)}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              disabled={!reason.trim()}
              onClick={() => {
                const l = losing!;
                setLosing(null);
                move(l.opp, l.stageId, reason.trim());
              }}
            >
              Marcar como perdida
            </Button>
          </>
        }
      >
        <Field label={`¿Por qué se perdió ${losing?.opp.customerName ?? ""}?`}>
          {(p) => <input {...p} value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} placeholder="Precio, competencia, no respondió…" />}
        </Field>
      </Modal>
    </div>
  );
}
