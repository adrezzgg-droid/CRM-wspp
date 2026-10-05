"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Play, Plus, Trash2, Workflow, X } from "lucide-react";
import type { Automation, AutomationAction, AutomationRun, AutomationTrigger, CustomerStage, TaskType } from "@/types/model";
import { CUSTOMER_STAGE_LABELS, TASK_TYPE_LABELS } from "@/types/model";
import { AUTOMATION_TRIGGERS, CUSTOMER_STAGES, TASK_TYPES } from "@/lib/schemas";
import { ACTION_LABELS, describeTrigger, EVENT_TRIGGERS, TRIGGER_LABELS } from "@/lib/automations";
import { TEMPLATE_VARIABLES } from "@/lib/templates";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import { Alert, Button, CheckboxGroup, Field, inputClass, Modal } from "@/components/ui/controls";
import { Badge } from "@/components/ui/badges";

type Option = { id: string; name: string };
type TemplateOption = Option & { approved: boolean };
interface Lookups {
  tags: Option[];
  templates: TemplateOption[];
  zones: Option[];
}

const ACTION_TYPES = Object.keys(ACTION_LABELS) as AutomationAction["type"][];

function defaultAction(type: AutomationAction["type"], l: Lookups): AutomationAction {
  switch (type) {
    case "enviar_mensaje":
      return { type, text: "Hola {{nombre}}! Gracias por escribirnos, en breve te atiende {{vendedor}}." };
    case "agregar_etiqueta":
      return { type, tagId: l.tags[0]?.id ?? "" };
    case "crear_tarea":
      return { type, taskType: "seguimiento", dueInHours: 24 };
    case "cambiar_estado_cliente":
      return { type, stage: "cliente_activo" };
    case "marcar_reactivar":
      return { type };
    case "notificar":
      return { type, to: "responsable", message: "Revisá a {{nombre}}" };
  }
}

function describeAction(a: AutomationAction, l: Lookups): string {
  switch (a.type) {
    case "enviar_mensaje":
      return a.templateId ? `Enviar plantilla ${l.templates.find((t) => t.id === a.templateId)?.name ?? "?"}` : `Enviar "${(a.text ?? "").slice(0, 40)}${(a.text?.length ?? 0) > 40 ? "…" : ""}"`;
    case "agregar_etiqueta":
      return `Etiqueta ${l.tags.find((t) => t.id === a.tagId)?.name ?? "?"}`;
    case "crear_tarea":
      return `Tarea de ${TASK_TYPE_LABELS[a.taskType].toLowerCase()} en ${a.dueInHours} h`;
    case "cambiar_estado_cliente":
      return `Etapa → ${CUSTOMER_STAGE_LABELS[a.stage]}`;
    case "marcar_reactivar":
      return "Marcar para reactivar";
    case "notificar":
      return `Avisar a ${a.to}`;
  }
}

function ActionEditor({ action, onChange, onRemove, l }: { action: AutomationAction; onChange: (a: AutomationAction) => void; onRemove: () => void; l: Lookups }) {
  const sel = "rounded-lg border border-line bg-surface px-2 py-1.5 text-sm";
  return (
    <li className="space-y-2 rounded-lg border border-line bg-canvas p-3">
      <div className="flex items-center gap-2">
        <select value={action.type} onChange={(e) => onChange(defaultAction(e.target.value as AutomationAction["type"], l))} className={`${sel} flex-1`} aria-label="Tipo de acción">
          {ACTION_TYPES.map((t) => (
            <option key={t} value={t}>
              {ACTION_LABELS[t]}
            </option>
          ))}
        </select>
        <button type="button" onClick={onRemove} className="rounded p-1.5 text-ink-muted hover:bg-red-50 hover:text-red-600" aria-label="Quitar acción">
          <X className="size-4" aria-hidden />
        </button>
      </div>
      {action.type === "enviar_mensaje" && (
        <div className="space-y-2">
          <select
            value={action.templateId ?? ""}
            onChange={(e) => onChange(e.target.value ? { type: "enviar_mensaje", templateId: e.target.value } : { type: "enviar_mensaje", text: action.text ?? "" })}
            className={`${sel} w-full`}
            aria-label="Plantilla"
          >
            <option value="">Texto libre (solo dentro de las 24 h)</option>
            {l.templates.map((t) => (
              <option key={t.id} value={t.id}>
                Plantilla: {t.name}
                {t.approved ? "" : " (sin aprobar)"}
              </option>
            ))}
          </select>
          {!action.templateId && (
            <>
              <textarea value={action.text ?? ""} onChange={(e) => onChange({ type: "enviar_mensaje", text: e.target.value })} rows={2} className={inputClass} aria-label="Mensaje" />
              <p className="text-xs text-ink-muted">Variables: {TEMPLATE_VARIABLES.map((v) => `{{${v}}}`).join(" ")}</p>
            </>
          )}
        </div>
      )}
      {action.type === "agregar_etiqueta" && (
        <select value={action.tagId} onChange={(e) => onChange({ ...action, tagId: e.target.value })} className={`${sel} w-full`} aria-label="Etiqueta">
          {l.tags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      )}
      {action.type === "crear_tarea" && (
        <div className="grid gap-2 sm:grid-cols-3">
          <select value={action.taskType} onChange={(e) => onChange({ ...action, taskType: e.target.value as TaskType })} className={sel} aria-label="Tipo de tarea">
            {TASK_TYPES.map((t) => (
              <option key={t} value={t}>
                {TASK_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-sm">
            en
            <input type="number" min={0} max={720} value={action.dueInHours} onChange={(e) => onChange({ ...action, dueInHours: Number(e.target.value) })} className={`${sel} w-20`} aria-label="Horas" />h
          </label>
          <input value={action.description ?? ""} onChange={(e) => onChange({ ...action, description: e.target.value })} placeholder="Descripción" className={sel} aria-label="Descripción" />
        </div>
      )}
      {action.type === "cambiar_estado_cliente" && (
        <select value={action.stage} onChange={(e) => onChange({ ...action, stage: e.target.value as CustomerStage })} className={`${sel} w-full`} aria-label="Etapa">
          {CUSTOMER_STAGES.map((s) => (
            <option key={s} value={s}>
              {CUSTOMER_STAGE_LABELS[s]}
            </option>
          ))}
        </select>
      )}
      {action.type === "marcar_reactivar" && <p className="text-xs text-ink-muted">Lo marca para reactivar, lo pasa a inactivo si estaba activo y avisa a su vendedor.</p>}
      {action.type === "notificar" && (
        <div className="grid gap-2 sm:grid-cols-3">
          <select value={action.to} onChange={(e) => onChange({ ...action, to: e.target.value as "responsable" })} className={sel} aria-label="A quién">
            <option value="responsable">Al responsable</option>
            <option value="supervisores">A sus supervisores</option>
            <option value="administradores">A los administradores</option>
          </select>
          <input value={action.message} onChange={(e) => onChange({ ...action, message: e.target.value })} className={`${sel} sm:col-span-2`} aria-label="Aviso" />
        </div>
      )}
    </li>
  );
}

function AutomationModal({ automation, l, onClose }: { automation?: Automation; l: Lookups; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(automation?.name ?? "");
  const [trigger, setTrigger] = useState<AutomationTrigger>(automation?.trigger ?? "mensaje_nuevo_contacto");
  const [hours, setHours] = useState(automation?.triggerParams.hours ?? 24);
  const [days, setDays] = useState(automation?.triggerParams.days ?? 30);
  const [delay, setDelay] = useState(automation?.delayMinutes ?? 0);
  const [stages, setStages] = useState<string[]>(automation?.conditions.stages ?? []);
  const [zoneIds, setZoneIds] = useState<string[]>(automation?.conditions.zoneIds ?? []);
  const [actions, setActions] = useState<AutomationAction[]>(automation?.actions ?? [defaultAction("enviar_mensaje", l)]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isEvent = EVENT_TRIGGERS.includes(trigger);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      name,
      enabled: automation?.enabled ?? true,
      trigger,
      triggerParams: trigger === "sin_respuesta_cliente" ? { hours } : trigger === "sin_compra_dias" ? { days } : {},
      conditions: { stages, zoneIds },
      delayMinutes: isEvent ? delay : 0,
      actions,
    };
    try {
      if (automation) await api("PATCH", `/api/automations/${automation.id}`, body);
      else await api("POST", "/api/automations", body);
      onClose();
      router.refresh();
    } catch (err) {
      const fe = err instanceof ApiClientError ? Object.values(err.fieldErrors)[0] : undefined;
      setError(fe ? `${errorMessage(err)}: ${fe}` : errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={automation ? "Editar automatización" : "Nueva automatización"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="automation-form" loading={busy}>
            Guardar
          </Button>
        </>
      }
    >
      <form id="automation-form" onSubmit={submit} className="space-y-5" noValidate>
        {error && <Alert>{error}</Alert>}
        <Field label="Nombre *">{(p) => <input {...p} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="Bienvenida a contactos nuevos" />}</Field>

        <fieldset className="space-y-3 rounded-xl border border-line p-3">
          <legend className="px-1 text-xs font-bold tracking-wide text-brand-700 uppercase">Si</legend>
          <select value={trigger} onChange={(e) => setTrigger(e.target.value as AutomationTrigger)} className={inputClass} aria-label="Disparador">
            {AUTOMATION_TRIGGERS.map((t) => (
              <option key={t} value={t}>
                {TRIGGER_LABELS[t]}
              </option>
            ))}
          </select>
          {trigger === "sin_respuesta_cliente" && (
            <label className="flex items-center gap-2 text-sm">
              durante <input type="number" min={1} max={720} value={hours} onChange={(e) => setHours(Number(e.target.value))} className="w-20 rounded-lg border border-line px-2 py-1" /> horas después de nuestro último mensaje
            </label>
          )}
          {trigger === "sin_compra_dias" && (
            <label className="flex items-center gap-2 text-sm">
              durante <input type="number" min={1} max={365} value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-20 rounded-lg border border-line px-2 py-1" /> días desde su última compra
            </label>
          )}
          <div>
            <p className="mb-1 text-xs text-ink-muted">Solo para clientes en estas etapas (vacío = todas):</p>
            <CheckboxGroup options={CUSTOMER_STAGES.map((s) => ({ id: s, label: CUSTOMER_STAGE_LABELS[s] }))} value={stages} onChange={setStages} />
          </div>
          {l.zones.length > 0 && (
            <div>
              <p className="mb-1 text-xs text-ink-muted">Solo para estas zonas (vacío = todas):</p>
              <CheckboxGroup options={l.zones.map((z) => ({ id: z.id, label: z.name }))} value={zoneIds} onChange={setZoneIds} />
            </div>
          )}
          {isEvent && (
            <label className="flex items-center gap-2 text-sm">
              Esperar <input type="number" min={0} max={10080} value={delay} onChange={(e) => setDelay(Number(e.target.value))} className="w-24 rounded-lg border border-line px-2 py-1" /> minutos antes de ejecutar
            </label>
          )}
        </fieldset>

        <fieldset className="space-y-3 rounded-xl border border-line p-3">
          <legend className="px-1 text-xs font-bold tracking-wide text-brand-700 uppercase">Entonces</legend>
          <ol className="space-y-2">
            {actions.map((a, i) => (
              <ActionEditor key={i} action={a} l={l} onChange={(next) => setActions((all) => all.map((x, j) => (j === i ? next : x)))} onRemove={() => setActions((all) => all.filter((_, j) => j !== i))} />
            ))}
          </ol>
          {actions.length < 10 && (
            <Button variant="ghost" className="px-2" onClick={() => setActions((all) => [...all, defaultAction("crear_tarea", l)])}>
              <Plus className="size-4" aria-hidden /> Agregar acción
            </Button>
          )}
        </fieldset>
      </form>
    </Modal>
  );
}

export function AutomationsManager({ automations, runs, lookups, canEdit, timezone }: { automations: Automation[]; runs: AutomationRun[]; lookups: Lookups; canEdit: boolean; timezone: string }) {
  const router = useRouter();
  const [modal, setModal] = useState<{ automation?: Automation } | null>(null);
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  const [running, setRunning] = useState(false);
  const fmt = new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short", timeZone: timezone });

  async function run(fn: () => Promise<unknown>) {
    setMessage(null);
    try {
      await fn();
      router.refresh();
    } catch (err) {
      setMessage({ tone: "error", text: errorMessage(err) });
    }
  }

  async function runNow() {
    setRunning(true);
    setMessage(null);
    try {
      const r = await api<{ jobs: number; noReply: number; noPurchase: number }>("POST", "/api/automations/run");
      const total = r.jobs + r.noReply + r.noPurchase;
      setMessage({ tone: "info", text: total ? `Se ejecutaron ${total} automatización(es): ${r.noReply} por falta de respuesta, ${r.noPurchase} por falta de compras, ${r.jobs} agendadas.` : "No había nada pendiente para ejecutar." });
      router.refresh();
    } catch (err) {
      setMessage({ tone: "error", text: errorMessage(err) });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-muted">Las de evento corren al instante; las de tiempo se revisan cada 5 minutos.</p>
        {canEdit && (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={runNow} loading={running}>
              <Play className="size-4" aria-hidden /> Ejecutar ahora
            </Button>
            <Button onClick={() => setModal({})}>
              <Plus className="size-4" aria-hidden /> Nueva
            </Button>
          </div>
        )}
      </div>
      {message && <Alert tone={message.tone}>{message.text}</Alert>}

      {automations.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-surface px-6 py-10 text-center text-sm text-ink-muted">
          <Workflow className="mx-auto mb-2 size-7" aria-hidden />
          Todavía no hay automatizaciones.
        </div>
      ) : (
        <ul className="space-y-2">
          {automations.map((a) => (
            <li key={a.id} className={`rounded-xl border bg-surface p-4 ${a.enabled ? "border-line" : "border-dashed border-line opacity-70"}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    {a.name}
                    {!a.enabled && <Badge>Pausada</Badge>}
                  </p>
                  <p className="mt-1 text-sm">
                    <span className="font-semibold text-brand-700">SI</span> {describeTrigger(a)}
                    {a.conditions.stages?.length ? ` (${a.conditions.stages.map((s) => CUSTOMER_STAGE_LABELS[s].toLowerCase()).join(", ")})` : ""}
                  </p>
                  <p className="text-sm">
                    <span className="font-semibold text-brand-700">ENTONCES</span> {a.actions.map((x) => describeAction(x, lookups)).join(" · ")}
                  </p>
                  <p className="mt-1 text-xs text-ink-muted">
                    {a.runsCount ? `${a.runsCount} ejecuciones · última ${a.lastRunAt ? fmt.format(a.lastRunAt) : ""}` : "Todavía no se ejecutó"}
                  </p>
                </div>
                {canEdit && (
                  <div className="flex items-center gap-1">
                    <label className="flex items-center gap-1.5 text-xs">
                      <input type="checkbox" role="switch" checked={a.enabled} onChange={(e) => run(() => api("POST", `/api/automations/${a.id}/toggle`, { enabled: e.target.checked }))} className="size-4 accent-brand-600" />
                      Activa
                    </label>
                    <button type="button" onClick={() => setModal({ automation: a })} className="rounded p-1.5 text-ink-muted hover:bg-canvas" aria-label={`Editar ${a.name}`}>
                      <Pencil className="size-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => window.confirm(`¿Eliminar "${a.name}"? Su historial de ejecuciones se conserva.`) && run(() => api("DELETE", `/api/automations/${a.id}`))}
                      className="rounded p-1.5 text-ink-muted hover:bg-red-50 hover:text-red-600"
                      aria-label={`Eliminar ${a.name}`}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <section className="rounded-xl border border-line bg-surface">
        <h3 className="border-b border-line px-4 py-3 text-sm font-semibold">Últimas ejecuciones</h3>
        {runs.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-ink-muted">Sin ejecuciones todavía.</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {runs.map((r) => (
              <li key={r.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-2">
                <span className="w-28 shrink-0 text-xs text-ink-muted">{fmt.format(r.at)}</span>
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{r.automationName}</span>
                  <span className="block text-xs text-ink-muted">
                    {r.results.map((x) => `${ACTION_LABELS[x.type]}: ${x.status}${x.detail ? ` (${x.detail})` : ""}`).join(" · ")}
                  </span>
                </span>
                <Badge tone={r.status === "ok" ? "brand" : r.status === "parcial" ? "warn" : r.status === "error" ? "danger" : "neutral"}>{r.status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      {modal && <AutomationModal automation={modal.automation} l={lookups} onClose={() => setModal(null)} />}
    </div>
  );
}
