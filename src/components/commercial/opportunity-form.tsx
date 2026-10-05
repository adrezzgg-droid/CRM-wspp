"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Opportunity, PipelineStage } from "@/types/model";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import { Alert, Button, Field, inputClass, Modal } from "@/components/ui/controls";
import { CustomerPicker, type PickedCustomer } from "./customer-picker";

export interface OpportunityFormOptions {
  stages: PipelineStage[];
  /** Responsables posibles; vacío = solo el propio usuario. */
  owners: { id: string; name: string }[];
  currency: string;
}

const toDateInput = (ms?: number) => (ms ? new Date(ms).toISOString().slice(0, 10) : "");
const fromDateInput = (v: string) => (v ? new Date(`${v}T12:00:00`).getTime() : null);

export function OpportunityFormModal({
  open,
  onClose,
  options,
  opportunity,
  customer,
  context,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  options: OpportunityFormOptions;
  /** Edición. */
  opportunity?: Opportunity;
  /** Cliente fijo (desde la ficha o la bandeja). */
  customer?: PickedCustomer;
  context?: { conversationId?: string; leadId?: string };
  onSaved?: (o: Opportunity) => void;
}) {
  const router = useRouter();
  const openStages = options.stages.filter((s) => s.kind === "abierta");
  const stages = opportunity ? options.stages : openStages;
  const [picked, setPicked] = useState<PickedCustomer | null>(customer ?? (opportunity ? { id: opportunity.customerId, name: opportunity.customerName } : null));
  const [v, setV] = useState({
    stageId: opportunity?.stageId ?? openStages[0]?.id ?? "",
    ownerId: opportunity?.ownerId ?? "",
    estimatedValue: String(opportunity?.estimatedValue ?? ""),
    product: opportunity?.product ?? "",
    expectedCloseAt: toDateInput(opportunity?.expectedCloseAt),
    probability: String(opportunity?.probability ?? openStages[0]?.probability ?? 10),
    nextAction: opportunity?.nextAction ?? "",
    notes: opportunity?.notes ?? "",
    lostReason: opportunity?.lostReason ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});
  const stage = options.stages.find((s) => s.id === v.stageId);

  const bind = (k: keyof typeof v) => ({
    value: v[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV((s) => ({ ...s, [k]: e.target.value })),
  });

  function changeStage(stageId: string) {
    const s = options.stages.find((x) => x.id === stageId);
    setV((cur) => ({ ...cur, stageId, probability: s ? String(s.probability) : cur.probability }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!picked) {
      setFe({ customerId: "Elegí un cliente" });
      return;
    }
    setBusy(true);
    setError(null);
    setFe({});
    const body: Record<string, unknown> = {
      stageId: v.stageId,
      estimatedValue: Number(v.estimatedValue || 0),
      product: v.product,
      expectedCloseAt: fromDateInput(v.expectedCloseAt),
      probability: Number(v.probability),
      nextAction: v.nextAction,
      notes: v.notes,
      ...(options.owners.length && v.ownerId ? { ownerId: v.ownerId } : {}),
      ...(stage?.kind === "perdida" ? { lostReason: v.lostReason } : {}),
    };
    try {
      const res = opportunity
        ? await api<{ opportunity: Opportunity }>("PATCH", `/api/opportunities/${opportunity.id}`, body)
        : await api<{ opportunity: Opportunity }>("POST", "/api/opportunities", { ...body, customerId: picked.id, ...context });
      onSaved?.(res.opportunity);
      onClose();
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiClientError) setFe(err.fieldErrors);
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={opportunity ? "Editar oportunidad" : "Nueva oportunidad"}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="opportunity-form" loading={busy}>
            Guardar
          </Button>
        </>
      }
    >
      <form id="opportunity-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        {error && <div className="sm:col-span-2"><Alert>{error}</Alert></div>}
        <div className="sm:col-span-2">
          <p className="mb-1 text-sm font-medium">Cliente *</p>
          {customer || opportunity ? (
            <p className="rounded-lg bg-canvas px-3 py-2 text-sm font-medium">{picked?.name}</p>
          ) : (
            <CustomerPicker value={picked} onChange={setPicked} invalid={!!fe.customerId} />
          )}
          {fe.customerId && <p className="mt-1 text-xs text-red-600">{fe.customerId}</p>}
        </div>
        <Field label="Producto o servicio" error={fe.product}>
          {(p) => <input {...p} {...bind("product")} className={inputClass} placeholder="Pollo entero x cajón" />}
        </Field>
        <Field label={`Valor estimado (${options.currency})`} error={fe.estimatedValue}>
          {(p) => <input {...p} {...bind("estimatedValue")} type="number" min={0} step="0.01" inputMode="decimal" className={inputClass} />}
        </Field>
        <Field label="Etapa" error={fe.stageId}>
          {(p) => (
            <select {...p} value={v.stageId} onChange={(e) => changeStage(e.target.value)} className={inputClass}>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Probabilidad (%)" error={fe.probability} hint="Se completa según la etapa.">
          {(p) => <input {...p} {...bind("probability")} type="number" min={0} max={100} className={inputClass} />}
        </Field>
        {stage?.kind === "perdida" && (
          <Field label="Motivo de la pérdida *" error={fe.lostReason} className="sm:col-span-2">
            {(p) => <input {...p} {...bind("lostReason")} className={inputClass} placeholder="Precio, competencia, no respondió…" />}
          </Field>
        )}
        <Field label="Cierre estimado" error={fe.expectedCloseAt}>
          {(p) => <input {...p} {...bind("expectedCloseAt")} type="date" className={inputClass} />}
        </Field>
        {options.owners.length > 0 ? (
          <Field label="Responsable" error={fe.ownerId} hint={opportunity ? undefined : "Vacío = el responsable del cliente."}>
            {(p) => (
              <select {...p} {...bind("ownerId")} className={inputClass}>
                {!opportunity && <option value="">Responsable del cliente</option>}
                {options.owners.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        ) : (
          <div className="hidden sm:block" />
        )}
        <Field label="Próxima acción" error={fe.nextAction} className="sm:col-span-2">
          {(p) => <input {...p} {...bind("nextAction")} className={inputClass} placeholder="Mandar lista de precios el lunes" />}
        </Field>
        <Field label="Notas" error={fe.notes} className="sm:col-span-2">
          {(p) => <textarea {...p} {...bind("notes")} rows={3} className={inputClass} />}
        </Field>
      </form>
    </Modal>
  );
}
