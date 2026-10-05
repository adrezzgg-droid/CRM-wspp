"use client";

import { useState } from "react";
import { FlaskConical } from "lucide-react";
import { DEMO_INBOUND_TYPES } from "@/lib/schemas";
import { ApiClientError, errorMessage } from "@/lib/api-client";
import { Alert, Button, Field, inputClass, Modal } from "@/components/ui/controls";

const TYPE_LABELS: Record<(typeof DEMO_INBOUND_TYPES)[number], string> = {
  text: "Texto",
  image: "Imagen",
  document: "Documento",
  audio: "Audio",
  video: "Video",
  location: "Ubicación",
  contacts: "Contacto",
  button_reply: "Respuesta a botón",
  list_reply: "Respuesta a lista",
};

const MEDIA = new Set(["image", "document", "audio", "video"]);

/**
 * Simula que un cliente escribe por WhatsApp. El mensaje entra por la misma
 * tubería que uno real de Meta (solo en organizaciones demo).
 */
export function SimulatorButton({ onCreated }: { onCreated: (conversationId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ phone: "", name: "", type: "text" as (typeof DEMO_INBOUND_TYPES)[number], text: "", placeName: "" });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFe({});
    try {
      const form = new FormData();
      for (const [k, value] of Object.entries(v)) if (value) form.set(k, value);
      if (file && MEDIA.has(v.type)) form.set("file", file);
      const res = await fetch("/api/demo/inbound", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as { error?: string; details?: unknown; conversationId?: string };
      if (!res.ok) throw new ApiClientError(res.status, data.error ?? "No se pudo simular el mensaje", data.details);
      setOpen(false);
      setV((s) => ({ ...s, text: "" }));
      setFile(null);
      if (data.conversationId) onCreated(data.conversationId);
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiClientError) setFe(err.fieldErrors);
    } finally {
      setBusy(false);
    }
  }

  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV((s) => ({ ...s, [k]: e.target.value }));

  return (
    <>
      <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => setOpen(true)}>
        <FlaskConical className="size-3.5" aria-hidden /> Simular mensaje
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Simular mensaje entrante (demo)"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" form="sim-form" loading={busy}>
              Recibir mensaje
            </Button>
          </>
        }
      >
        <form id="sim-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
          <p className="text-xs text-ink-muted sm:col-span-2">
            Se arma el mismo JSON que envía Meta y entra por el webhook interno: crea el cliente y el lead si el número es nuevo, abre la conversación y avisa al equipo.
          </p>
          {error && <div className="sm:col-span-2"><Alert>{error}</Alert></div>}
          <Field label="Número del cliente *" error={fe.phone} hint="Ej.: 351 555 1234">
            {(p) => <input {...p} value={v.phone} onChange={set("phone")} inputMode="tel" className={inputClass} />}
          </Field>
          <Field label="Nombre de perfil" error={fe.name}>
            {(p) => <input {...p} value={v.name} onChange={set("name")} className={inputClass} placeholder="Como figura en su WhatsApp" />}
          </Field>
          <Field label="Tipo de mensaje">
            {(p) => (
              <select {...p} value={v.type} onChange={set("type")} className={inputClass}>
                {DEMO_INBOUND_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          {v.type === "location" ? (
            <Field label="Nombre del lugar">{(p) => <input {...p} value={v.placeName} onChange={set("placeName")} className={inputClass} placeholder="Local de Av. Colón" />}</Field>
          ) : MEDIA.has(v.type) ? (
            <Field label="Archivo *" hint="JPG/PNG, PDF, MP3/OGG o MP4 según el tipo.">
              {(p) => <input {...p} type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm" />}
            </Field>
          ) : (
            <div className="hidden sm:block" />
          )}
          {v.type !== "location" && (
            <Field
              label={v.type === "contacts" ? "Nombre del contacto compartido" : v.type.endsWith("reply") ? "Opción elegida" : MEDIA.has(v.type) ? "Descripción" : "Texto"}
              error={fe.text}
              className="sm:col-span-2"
            >
              {(p) => <textarea {...p} value={v.text} onChange={set("text")} rows={3} className={inputClass} placeholder={v.type === "text" ? "Hola, ¿tienen pollo entero?" : ""} />}
            </Field>
          )}
        </form>
      </Modal>
    </>
  );
}
