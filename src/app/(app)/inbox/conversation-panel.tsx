"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, Pencil, X } from "lucide-react";
import type { Conversation, Customer } from "@/types/model";
import { CONVERSATION_STATUS_LABELS } from "@/types/model";
import { CONVERSATION_PRIORITIES } from "@/lib/schemas";
import { formatWhatsappId } from "@/lib/phone";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import { Alert, Button, CheckboxGroup } from "@/components/ui/controls";
import { inputClass } from "@/components/ui/styles";
import { StageBadge, TagChip } from "@/components/ui/badges";
import { CustomerFormModal } from "../clientes/customer-form";
import type { InboxProps } from "./types";

type CustomerState = { status: "loading" } | { status: "ok"; customer: Customer } | { status: "hidden" } | { status: "error"; message: string };

const PRIORITY_LABELS: Record<(typeof CONVERSATION_PRIORITIES)[number], string> = { baja: "Baja", normal: "Normal", alta: "Alta", urgente: "Urgente" };

export function ConversationPanel({
  props,
  conversation: c,
  names,
  onClose,
}: {
  props: InboxProps;
  conversation: Conversation;
  names: Map<string, string>;
  onClose: () => void;
}) {
  const [customer, setCustomer] = useState<CustomerState>({ status: "loading" });
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Datos del cliente desde la API (respeta el alcance: si no es suyo, 404).
  // También se recargan cuando cambian el nombre, la etapa o quién atiende
  // (asignar la conversación puede asignar también al cliente).
  useEffect(() => {
    let cancelled = false;
    api<{ customer: Customer }>("GET", `/api/customers/${c.customerId}`)
      .then((r) => !cancelled && setCustomer({ status: "ok", customer: r.customer }))
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiClientError && (err.status === 404 || err.status === 403)) setCustomer({ status: "hidden" });
        else setCustomer({ status: "error", message: errorMessage(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [c.customerId, c.contactName, c.customerStage, c.assigneeId, reload]);

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const update = (body: Record<string, unknown>, key: string) => run(key, () => api("PATCH", `/api/conversations/${c.id}`, body));
  const assign = (assigneeId: string | null) => run("assign", () => api("POST", `/api/conversations/${c.id}/assign`, { assigneeId }));
  const tagsById = new Map(props.tags.map((t) => [t.id, t]));
  const editable = props.canEdit;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4">
        <h2 className="text-sm font-semibold">Cliente y conversación</h2>
        <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-ink-muted hover:bg-canvas xl:hidden" aria-label="Cerrar">
          <X className="size-5" aria-hidden />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 text-sm">
        {error && <Alert>{error}</Alert>}

        {/* Cliente */}
        <section className="space-y-2">
          {customer.status === "loading" && <p className="text-ink-muted">Cargando cliente…</p>}
          {customer.status === "error" && <Alert>{customer.message}</Alert>}
          {customer.status === "hidden" && (
            <p className="rounded-lg bg-canvas p-3 text-xs text-ink-muted">
              {c.contactName} · {formatWhatsappId(c.waContactId)}. La ficha del cliente está a cargo de otro vendedor.
            </p>
          )}
          {customer.status === "ok" && (
            <>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-base font-semibold">{customer.customer.name}</p>
                  {customer.customer.company && <p className="text-xs text-ink-muted">{customer.customer.company}</p>}
                </div>
                {props.canEditCustomer && props.customerOptions && !customer.customer.archived && (
                  <button type="button" onClick={() => setEditing(true)} className="rounded-lg p-1.5 text-ink-muted hover:bg-canvas" aria-label="Editar cliente">
                    <Pencil className="size-4" aria-hidden />
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                <StageBadge stage={customer.customer.stage} />
                {customer.customer.tagIds.map((id) => {
                  const t = tagsById.get(id);
                  return t ? <TagChip key={id} name={t.name} color={t.color} /> : null;
                })}
              </div>
              <dl className="space-y-1 text-xs">
                {[
                  ["WhatsApp", formatWhatsappId(c.waContactId)],
                  ["Email", customer.customer.email],
                  ["Dirección", [customer.customer.address, customer.customer.neighborhood, customer.customer.locality].filter(Boolean).join(", ")],
                  ["Rubro", customer.customer.industry],
                  ["Responsable", customer.customer.ownerId ? names.get(customer.customer.ownerId) : "Sin asignar"],
                ].map(([label, value]) => (
                  <div key={label} className="grid grid-cols-3 gap-2">
                    <dt className="text-ink-muted">{label}</dt>
                    <dd className="col-span-2 break-words">{value || "—"}</dd>
                  </div>
                ))}
              </dl>
              <Link href={`/clientes/${customer.customer.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline">
                Ver ficha completa <ExternalLink className="size-3" aria-hidden />
              </Link>
              {editing && props.customerOptions && (
                <CustomerFormModal
                  open
                  customer={customer.customer}
                  options={props.customerOptions}
                  defaultOwner={customer.customer.ownerId ?? ""}
                  onClose={() => {
                    setEditing(false);
                    setReload((n) => n + 1);
                  }}
                />
              )}
            </>
          )}
        </section>

        {/* Conversación */}
        <section className="space-y-3 border-t border-line pt-4">
          <h3 className="text-xs font-semibold tracking-wide text-ink-muted uppercase">Conversación</h3>

          <label className="block">
            <span className="mb-1 block text-xs text-ink-muted">Estado</span>
            <select
              value={c.status}
              disabled={!editable || busy === "status"}
              onChange={(e) => update({ status: e.target.value }, "status")}
              className={inputClass}
            >
              {c.status === "nueva" && <option value="nueva">{CONVERSATION_STATUS_LABELS.nueva}</option>}
              {(["pendiente", "en_atencion", "cerrada"] as const).map((s) => (
                <option key={s} value={s}>
                  {CONVERSATION_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs text-ink-muted">Prioridad</span>
            <select value={c.priority} disabled={!editable || busy === "priority"} onChange={(e) => update({ priority: e.target.value }, "priority")} className={inputClass}>
              {CONVERSATION_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs text-ink-muted">Atiende</span>
            {props.canAssign ? (
              <select value={c.assigneeId ?? ""} disabled={busy === "assign"} onChange={(e) => assign(e.target.value || null)} className={inputClass}>
                <option value="">Sin asignar</option>
                {c.assigneeId && !props.assignable.some((a) => a.id === c.assigneeId) && <option value={c.assigneeId}>{names.get(c.assigneeId) ?? "Otro usuario"}</option>}
                {props.assignable.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            ) : (
              <p className="rounded-lg bg-canvas px-3 py-2">{c.assigneeId ? names.get(c.assigneeId) ?? "—" : "Sin asignar"}</p>
            )}
          </label>

          <div>
            <span className="mb-1 block text-xs text-ink-muted">Etiquetas</span>
            <CheckboxGroup
              options={props.tags.map((t) => ({ id: t.id, label: t.name, color: t.color }))}
              value={c.tagIds}
              disabled={!editable || busy === "tags"}
              onChange={(tagIds) => update({ tagIds }, "tags")}
              empty="No hay etiquetas creadas."
            />
          </div>

          {editable && c.status !== "cerrada" && (
            <Button variant="secondary" className="w-full" loading={busy === "close"} onClick={() => update({ status: "cerrada" }, "close")}>
              Cerrar conversación
            </Button>
          )}
        </section>

        <section className="space-y-2 border-t border-line pt-4">
          <h3 className="text-xs font-semibold tracking-wide text-ink-muted uppercase">Próximamente</h3>
          <Button variant="ghost" disabled className="w-full justify-start" title="Se habilita en la Fase 6">
            Crear tarea · Fase 6
          </Button>
          <Button variant="ghost" disabled className="w-full justify-start" title="Se habilita en la Fase 5">
            Crear oportunidad o pedido · Fase 5
          </Button>
        </section>
      </div>
    </div>
  );
}
