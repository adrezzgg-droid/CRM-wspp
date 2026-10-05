"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import { Alert, Button, Field } from "@/components/ui/controls";
import { inputClass } from "@/components/ui/styles";

type Settings = { autoAssign: boolean; useZones: boolean; zoneFallback: boolean; slaEnabled: boolean; slaMinutes: number };

function Toggle({ checked, onChange, disabled, label, hint }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string; hint: string }) {
  return (
    <label className={`flex gap-3 ${disabled ? "opacity-60" : ""}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-brand-600" />
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-ink-muted">{hint}</span>
      </span>
    </label>
  );
}

export function AssignmentForm({
  initial,
  readOnly,
  canRunSla,
  sellers,
}: {
  initial: Settings;
  readOnly: boolean;
  canRunSla: boolean;
  sellers: { total: number; available: number };
}) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success" | "info"; text: string } | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});
  const [checking, setChecking] = useState(false);
  const set = <K extends keyof Settings>(k: K, value: Settings[K]) => setV((s) => ({ ...s, [k]: value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    setFe({});
    try {
      await api("PUT", "/api/settings/assignment", v);
      setMessage({ tone: "success", text: "Reglas guardadas. Se aplican a los próximos mensajes." });
      router.refresh();
    } catch (err) {
      setMessage({ tone: "error", text: errorMessage(err) });
      if (err instanceof ApiClientError) setFe(err.fieldErrors);
    } finally {
      setBusy(false);
    }
  }

  async function runSla() {
    setChecking(true);
    setMessage(null);
    try {
      const r = await api<{ enabled: boolean; alerted: number }>("POST", "/api/assignment/sla");
      setMessage({
        tone: "info",
        text: !r.enabled ? "La alerta de demora está desactivada." : r.alerted ? `Se enviaron ${r.alerted} alerta(s) de demora.` : "No hay conversaciones demoradas sin avisar.",
      });
    } catch (err) {
      setMessage({ tone: "error", text: errorMessage(err) });
    } finally {
      setChecking(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-5 rounded-xl border border-line bg-surface p-4" noValidate>
      <fieldset className="space-y-3">
        <legend className="mb-1 text-sm font-semibold">Conversaciones nuevas</legend>
        <p className="text-xs text-ink-muted">
          Si el cliente ya tiene vendedor, siempre se le asigna a él. Estas reglas deciden qué pasa con los que no tienen.
          Hoy hay {sellers.available} de {sellers.total} vendedores disponibles.
        </p>
        <Toggle checked={v.autoAssign} disabled={readOnly} onChange={(x) => set("autoAssign", x)} label="Asignar automáticamente" hint="Reparte por turno entre los vendedores disponibles. Si está apagado, quedan sin asignar para que las reparta un supervisor." />
        <Toggle checked={v.useZones} disabled={readOnly || !v.autoAssign} onChange={(x) => set("useZones", x)} label="Respetar las zonas" hint="Si el cliente tiene zona, se asigna a un vendedor que la cubra." />
        <Toggle
          checked={v.zoneFallback}
          disabled={readOnly || !v.autoAssign || !v.useZones}
          onChange={(x) => set("zoneFallback", x)}
          label="Si nadie cubre la zona, asignar a cualquier vendedor"
          hint="Si está apagado, esos clientes quedan sin asignar."
        />
      </fieldset>

      <fieldset className="space-y-3 border-t border-line pt-4">
        <legend className="mb-1 text-sm font-semibold">Tiempo máximo de respuesta</legend>
        <Toggle checked={v.slaEnabled} disabled={readOnly} onChange={(x) => set("slaEnabled", x)} label="Avisar si nadie responde" hint="Avisa al vendedor y a su supervisor (o a los administradores si no tiene responsable). Una vez por espera." />
        <Field label="Minutos de espera" error={fe.slaMinutes} className="max-w-40">
          {(p) => (
            <input {...p} type="number" min={1} max={1440} value={v.slaMinutes} onChange={(e) => set("slaMinutes", Number(e.target.value))} disabled={readOnly || !v.slaEnabled} className={inputClass} />
          )}
        </Field>
        <p className="text-xs text-ink-muted">La revisión automática corre cada 5 minutos en el servidor. También podés lanzarla ahora.</p>
      </fieldset>

      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      <div className="flex flex-wrap justify-end gap-2">
        {canRunSla && (
          <Button variant="secondary" onClick={runSla} loading={checking}>
            Revisar demoras ahora
          </Button>
        )}
        {!readOnly && (
          <Button type="submit" loading={busy}>
            Guardar
          </Button>
        )}
      </div>
    </form>
  );
}
