"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import type { Lead, LeadStatus } from "@/types/model";
import { LEAD_STATUS_LABELS } from "@/types/model";
import { LEAD_FLOW } from "@/lib/assignment";
import { api, errorMessage } from "@/lib/api-client";
import { Alert, Button } from "@/components/ui/controls";
import { inputClass } from "@/components/ui/styles";

/**
 * Recorrido del lead: recibido → asignado → contactado → negociación →
 * pedido → venta → cerrado, con la fecha de cada paso. Quien atiende puede
 * avanzarlo (o marcarlo perdido con motivo).
 */
export function LeadTrace({ lead, timezone, canEdit, compact = false }: { lead: Lead; timezone: string; canEdit: boolean; compact?: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState<LeadStatus>(lead.status);
  const [reason, setReason] = useState(lead.lostReason ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fmt = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: timezone });
  const lost = lead.status === "perdido";
  const reached = LEAD_FLOW.indexOf(lead.status);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api("PATCH", `/api/leads/${lead.id}`, { status, lostReason: status === "perdido" ? reason : undefined });
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <ol className={compact ? "space-y-1" : "grid gap-1 sm:grid-cols-2"}>
        {LEAD_FLOW.map((s, i) => {
          const at = lead.statusAt?.[s];
          const done = !lost && (i <= reached || !!at);
          return (
            <li key={s} className="flex items-center gap-2 text-xs">
              <span
                className={`grid size-5 shrink-0 place-items-center rounded-full border ${done ? "border-brand-600 bg-brand-600 text-white" : at ? "border-brand-300 bg-brand-50 text-brand-700" : "border-line text-ink-muted"}`}
                aria-hidden
              >
                {done || at ? <Check className="size-3" /> : <span className="size-1.5 rounded-full bg-line" />}
              </span>
              <span className={lead.status === s ? "font-semibold" : done ? "" : "text-ink-muted"}>{LEAD_STATUS_LABELS[s]}</span>
              {at && <span className="ml-auto text-ink-muted">{fmt.format(at)}</span>}
            </li>
          );
        })}
        {lost && (
          <li className="flex items-center gap-2 text-xs font-semibold text-red-700">
            <span className="grid size-5 place-items-center rounded-full bg-red-600 text-white" aria-hidden>
              <X className="size-3" />
            </span>
            Perdido{lead.lostReason ? `: ${lead.lostReason}` : ""}
            {lead.statusAt?.perdido && <span className="ml-auto font-normal text-ink-muted">{fmt.format(lead.statusAt.perdido)}</span>}
          </li>
        )}
      </ol>

      {canEdit && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <label className="sr-only" htmlFor={`lead-${lead.id}`}>
              Estado del lead
            </label>
            <select id={`lead-${lead.id}`} value={status} onChange={(e) => setStatus(e.target.value as LeadStatus)} className={`${inputClass} py-1.5`}>
              {[...LEAD_FLOW, "perdido" as const].map((s) => (
                <option key={s} value={s}>
                  {LEAD_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
            <Button variant="secondary" className="shrink-0 py-1.5" onClick={save} loading={busy} disabled={status === lead.status && (status !== "perdido" || reason === (lead.lostReason ?? ""))}>
              Guardar
            </Button>
          </div>
          {status === "perdido" && (
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo (precio, competencia, no respondió…)" className={`${inputClass} py-1.5`} aria-label="Motivo de la pérdida" />
          )}
          {error && <Alert>{error}</Alert>}
        </div>
      )}
    </div>
  );
}
