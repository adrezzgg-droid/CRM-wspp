"use client";

import { useMemo, useState } from "react";
import { FileText } from "lucide-react";
import { renderTemplate, TEMPLATE_VARIABLE_LABELS, toMetaBody, type TemplateVariable } from "@/lib/templates";
import { api, errorMessage } from "@/lib/api-client";
import { Alert, Button, Field, inputClass, Modal } from "@/components/ui/controls";

export type TemplateOption = { id: string; name: string; body: string };

/**
 * Envío de una plantilla aprobada. Las variables vienen precargadas con los
 * datos de la conversación y se pueden corregir antes de enviar.
 */
export function TemplateSendButton({
  conversationId,
  templates,
  defaults,
  prominent,
}: {
  conversationId: string;
  templates: TemplateOption[];
  defaults: Partial<Record<TemplateVariable, string>>;
  /** Fuera de las 24 h: es la única forma de escribir, se muestra como botón principal. */
  prominent?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [values, setValues] = useState<Record<string, string>>(defaults as Record<string, string>);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tpl = templates.find((t) => t.id === templateId);
  const vars = useMemo(() => (tpl ? toMetaBody(tpl.body).order : []), [tpl]);

  async function send() {
    if (!tpl) return;
    setBusy(true);
    setError(null);
    try {
      await api("POST", `/api/conversations/${conversationId}/template`, { templateId: tpl.id, values: Object.fromEntries(vars.map((v) => [v, values[v] ?? ""])) });
      setOpen(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!templates.length) {
    return prominent ? <p className="text-xs">No hay plantillas aprobadas. Creálas en Configuración → Plantillas.</p> : null;
  }

  return (
    <>
      {prominent ? (
        <Button variant="secondary" className="mt-2 px-2.5 py-1.5 text-xs" onClick={() => setOpen(true)}>
          <FileText className="size-3.5" aria-hidden /> Enviar plantilla
        </Button>
      ) : (
        <button type="button" onClick={() => setOpen(true)} title="Enviar plantilla" className="rounded-lg p-2 text-ink-muted hover:bg-canvas">
          <FileText className="size-5" aria-hidden />
          <span className="sr-only">Enviar plantilla</span>
        </button>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Enviar plantilla de WhatsApp"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={send} loading={busy} disabled={!tpl || vars.some((v) => !values[v]?.trim())}>
              Enviar
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {error && <Alert>{error}</Alert>}
          <Field label="Plantilla aprobada">
            {(p) => (
              <select {...p} value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={inputClass}>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {vars.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              {vars.map((v) => (
                <Field key={v} label={TEMPLATE_VARIABLE_LABELS[v as TemplateVariable] ?? v}>
                  {(p) => <input {...p} value={values[v] ?? ""} onChange={(e) => setValues((s) => ({ ...s, [v]: e.target.value }))} className={inputClass} />}
                </Field>
              ))}
            </div>
          )}
          {tpl && (
            <div>
              <p className="mb-1 text-xs font-medium text-ink-muted">Así lo va a recibir</p>
              <p className="rounded-xl rounded-br-sm bg-brand-100 px-3 py-2 text-sm whitespace-pre-wrap">{renderTemplate(tpl.body, values)}</p>
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
