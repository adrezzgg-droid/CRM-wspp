"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageSquareText, Pencil, Plus, Trash2 } from "lucide-react";
import type { WhatsappTemplate } from "@/types/model";
import { TEMPLATE_CATEGORIES, META_STATUSES } from "@/lib/schemas";
import { renderTemplate, SAMPLE_VALUES, suggestMetaName, TEMPLATE_VARIABLES, TEMPLATE_VARIABLE_LABELS, toMetaBody } from "@/lib/templates";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import { Alert, Button, Field, inputClass, Modal } from "@/components/ui/controls";
import { Badge } from "@/components/ui/badges";

const CATEGORY_LABELS = { marketing: "Marketing", utility: "Servicio (utility)", authentication: "Autenticación" } as const;
const STATUS_LABELS = { borrador: "Borrador", pendiente: "En revisión de Meta", aprobada: "Aprobada", rechazada: "Rechazada" } as const;
const STATUS_TONE = { borrador: "neutral", pendiente: "warn", aprobada: "brand", rechazada: "danger" } as const;

type Row = Pick<WhatsappTemplate, "id" | "name" | "category" | "language" | "body" | "metaStatus">;

const SUGGESTIONS = [
  { label: "Bienvenida", category: "utility", body: "¡Hola {{nombre}}! Gracias por escribirnos. Soy {{vendedor}} y te voy a atender. ¿En qué te ayudo?" },
  { label: "Seguimiento", category: "marketing", body: "Hola {{nombre}}, ¿pudiste ver la propuesta que te pasamos? Cualquier duda, escribime. {{vendedor}}" },
  { label: "Reactivación", category: "marketing", body: "¡Hola {{nombre}}! Hace un tiempo que no te vemos. Esta semana tenemos precios especiales para {{empresa}}. ¿Te paso la lista?" },
  { label: "Confirmación de pedido", category: "utility", body: "{{nombre}}, tu pedido {{pedido}} por {{importe}} quedó confirmado el {{fecha}}. ¡Gracias por tu compra!" },
  { label: "Postventa", category: "utility", body: "Hola {{nombre}}, ¿llegó todo bien con tu pedido {{pedido}}? Contanos cómo te fue." },
] as const;

function TemplateModal({ template, onClose }: { template?: Row; onClose: () => void }) {
  const router = useRouter();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [v, setV] = useState({
    name: template?.name ?? "",
    category: template?.category ?? ("utility" as Row["category"]),
    language: template?.language ?? "es_AR",
    body: template?.body ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});
  const meta = toMetaBody(v.body);

  function insert(variable: string) {
    const el = ref.current;
    const token = `{{${variable}}}`;
    if (!el) return setV((s) => ({ ...s, body: s.body + token }));
    const start = el.selectionStart ?? v.body.length;
    const end = el.selectionEnd ?? v.body.length;
    const body = v.body.slice(0, start) + token + v.body.slice(end);
    setV((s) => ({ ...s, body }));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFe({});
    try {
      if (template) await api("PATCH", `/api/templates/${template.id}`, v);
      else await api("POST", "/api/templates", v);
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
      open
      onClose={onClose}
      size="lg"
      title={template ? "Editar plantilla" : "Nueva plantilla"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="template-form" loading={busy}>
            Guardar
          </Button>
        </>
      }
    >
      <form id="template-form" onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert>{error}</Alert>}
        {!template && (
          <div>
            <p className="mb-1 text-xs text-ink-muted">Empezar desde un modelo:</p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => setV({ name: suggestMetaName(s.label), category: s.category, language: "es_AR", body: s.body })}
                  className="rounded-full border border-line px-2.5 py-1 text-xs hover:bg-canvas"
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Nombre técnico *" error={fe.name} hint="Como lo registra Meta." className="sm:col-span-1">
            {(p) => <input {...p} value={v.name} onChange={(e) => setV((s) => ({ ...s, name: e.target.value.toLowerCase() }))} className={`${inputClass} font-mono`} placeholder="confirmacion_pedido" />}
          </Field>
          <Field label="Categoría" error={fe.category}>
            {(p) => (
              <select {...p} value={v.category} onChange={(e) => setV((s) => ({ ...s, category: e.target.value as Row["category"] }))} className={inputClass}>
                {TEMPLATE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Idioma" error={fe.language}>
            {(p) => <input {...p} value={v.language} onChange={(e) => setV((s) => ({ ...s, language: e.target.value }))} className={inputClass} />}
          </Field>
        </div>
        <div>
          <Field label="Mensaje *" error={fe.body}>
            {(p) => <textarea {...p} ref={ref} value={v.body} onChange={(e) => setV((s) => ({ ...s, body: e.target.value }))} rows={4} maxLength={1024} className={inputClass} />}
          </Field>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {TEMPLATE_VARIABLES.map((x) => (
              <button key={x} type="button" onClick={() => insert(x)} title={TEMPLATE_VARIABLE_LABELS[x]} className="rounded-md bg-brand-50 px-2 py-0.5 font-mono text-xs text-brand-800 hover:bg-brand-100">
                {`{{${x}}}`}
              </button>
            ))}
          </div>
        </div>
        {v.body && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <p className="mb-1 text-xs font-medium text-ink-muted">Vista previa</p>
              <p className="rounded-xl rounded-br-sm bg-brand-100 px-3 py-2 text-sm whitespace-pre-wrap">{renderTemplate(v.body, SAMPLE_VALUES)}</p>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-ink-muted">Así se registra en Meta</p>
              <p className="rounded-lg bg-canvas px-3 py-2 font-mono text-xs whitespace-pre-wrap">{meta.text}</p>
              {meta.order.length > 0 && <p className="mt-1 text-xs text-ink-muted">{meta.order.map((o, i) => `{{${i + 1}}} = ${o}`).join(" · ")}</p>}
            </div>
          </div>
        )}
        {template && template.metaStatus !== "borrador" && <Alert tone="info">Si cambiás el texto, vuelve a borrador: Meta tiene que aprobarlo de nuevo.</Alert>}
      </form>
    </Modal>
  );
}

export function TemplatesManager({ templates, canEdit, isDemo }: { templates: Row[]; canEdit: boolean; isDemo: boolean }) {
  const router = useRouter();
  const [modal, setModal] = useState<{ template?: Row } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="space-y-3">
      <Alert tone="info">
        Fuera de las 24 h desde el último mensaje del cliente, WhatsApp solo permite escribirle con plantillas aprobadas por Meta.
        {isDemo ? " En el demo podés simular la aprobación." : " El envío a aprobación se conecta en la Fase 9."}
      </Alert>
      {canEdit && (
        <div className="flex justify-end">
          <Button onClick={() => setModal({})}>
            <Plus className="size-4" aria-hidden /> Nueva plantilla
          </Button>
        </div>
      )}
      {error && <Alert>{error}</Alert>}
      {templates.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-surface px-6 py-10 text-center text-sm text-ink-muted">
          <MessageSquareText className="mx-auto mb-2 size-7" aria-hidden />
          Todavía no hay plantillas.
        </div>
      ) : (
        <ul className="space-y-2">
          {templates.map((t) => (
            <li key={t.id} className="rounded-xl border border-line bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-mono text-sm font-medium">
                    {t.name}
                    <Badge tone={STATUS_TONE[t.metaStatus]}>{STATUS_LABELS[t.metaStatus]}</Badge>
                  </p>
                  <p className="text-xs text-ink-muted">
                    {CATEGORY_LABELS[t.category]} · {t.language}
                  </p>
                </div>
                {canEdit && (
                  <div className="flex items-center gap-1">
                    {isDemo && (
                      <select
                        value={t.metaStatus}
                        onChange={(e) => run(() => api("POST", `/api/templates/${t.id}/status`, { metaStatus: e.target.value }))}
                        className="rounded border border-line bg-surface px-1.5 py-1 text-xs"
                        aria-label={`Simular estado de Meta para ${t.name}`}
                        title="Simular estado de Meta (demo)"
                      >
                        {META_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {STATUS_LABELS[s]}
                          </option>
                        ))}
                      </select>
                    )}
                    <button type="button" onClick={() => setModal({ template: t })} className="rounded p-1.5 text-ink-muted hover:bg-canvas" aria-label={`Editar ${t.name}`}>
                      <Pencil className="size-4" aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => window.confirm(`¿Eliminar la plantilla ${t.name}?`) && run(() => api("DELETE", `/api/templates/${t.id}`))}
                      className="rounded p-1.5 text-ink-muted hover:bg-red-50 hover:text-red-600"
                      aria-label={`Eliminar ${t.name}`}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  </div>
                )}
              </div>
              <p className="mt-2 rounded-lg bg-canvas px-3 py-2 text-sm whitespace-pre-wrap">{t.body}</p>
            </li>
          ))}
        </ul>
      )}
      {modal && <TemplateModal template={modal.template} onClose={() => setModal(null)} />}
    </div>
  );
}
