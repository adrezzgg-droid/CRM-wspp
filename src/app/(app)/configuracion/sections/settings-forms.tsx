"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import { Alert, Button, Field, inputClass } from "@/components/ui/controls";

function useSave() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setMessage(null);
    setFe({});
    try {
      await fn();
      setMessage({ tone: "success", text: "Cambios guardados." });
      router.refresh();
    } catch (err) {
      setMessage({ tone: "error", text: errorMessage(err) });
      if (err instanceof ApiClientError) setFe(err.fieldErrors);
    } finally {
      setBusy(false);
    }
  }
  return { busy, message, fe, run };
}

const TIMEZONES = ["America/Argentina/Buenos_Aires", "America/Argentina/Cordoba", "America/Argentina/Mendoza", "America/Argentina/Salta", "America/Argentina/Ushuaia", "America/Montevideo", "America/Santiago", "America/Asuncion", "America/Sao_Paulo", "America/Bogota", "America/Lima", "America/Mexico_City", "Europe/Madrid"];

export function OrganizationForm({ initial, readOnly }: { initial: { name: string; timezone: string; currency: string }; readOnly: boolean }) {
  const [v, setV] = useState(initial);
  const { busy, message, fe, run } = useSave();
  const zones = TIMEZONES.includes(initial.timezone) ? TIMEZONES : [initial.timezone, ...TIMEZONES];
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(() => api("PATCH", "/api/settings/organization", v));
      }}
      className="space-y-4 rounded-xl border border-line bg-surface p-4"
      noValidate
    >
      <Field label="Nombre de la empresa" error={fe.name}>
        {(p) => <input {...p} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} className={inputClass} disabled={readOnly} />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Zona horaria" error={fe.timezone} hint="Se usa para fechas, horarios y reportes.">
          {(p) => (
            <select {...p} value={v.timezone} onChange={(e) => setV({ ...v, timezone: e.target.value })} className={inputClass} disabled={readOnly}>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Moneda" error={fe.currency} hint="Código de 3 letras: ARS, USD, UYU…">
          {(p) => <input {...p} value={v.currency} onChange={(e) => setV({ ...v, currency: e.target.value.toUpperCase() })} maxLength={3} className={inputClass} disabled={readOnly} />}
        </Field>
      </div>
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      {!readOnly && (
        <div className="flex justify-end">
          <Button type="submit" loading={busy}>
            Guardar
          </Button>
        </div>
      )}
    </form>
  );
}

const DAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

export function GeneralForm({
  initial,
  readOnly,
}: {
  initial: { defaultCountryCode: string; businessHours: { days: number[]; from: string; to: string } | null };
  readOnly: boolean;
}) {
  const [country, setCountry] = useState(initial.defaultCountryCode);
  const [hoursOn, setHoursOn] = useState(!!initial.businessHours);
  const [hours, setHours] = useState(initial.businessHours ?? { days: [1, 2, 3, 4, 5], from: "08:00", to: "18:00" });
  const { busy, message, fe, run } = useSave();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(() => api("PUT", "/api/settings/general", { defaultCountryCode: country, businessHours: hoursOn ? hours : null }));
      }}
      className="space-y-5 rounded-xl border border-line bg-surface p-4"
      noValidate
    >
      <Field label="Código de país por defecto" error={fe.defaultCountryCode} hint="Para interpretar teléfonos cargados sin prefijo. Argentina = 54." className="max-w-xs">
        {(p) => <input {...p} value={country} onChange={(e) => setCountry(e.target.value.replace(/\D/g, ""))} inputMode="numeric" className={inputClass} disabled={readOnly} />}
      </Field>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Horario de atención</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={hoursOn} onChange={(e) => setHoursOn(e.target.checked)} disabled={readOnly} className="size-4 accent-brand-600" />
          Medir tiempos de respuesta solo dentro del horario de atención
        </label>
        {hoursOn && (
          <div className="space-y-3 rounded-lg bg-canvas p-3">
            <div className="flex flex-wrap gap-1.5">
              {DAYS.map((d, i) => {
                const on = hours.days.includes(i);
                return (
                  <label key={d} className={`cursor-pointer rounded-lg border px-2.5 py-1 text-xs font-medium ${on ? "border-brand-500 bg-brand-50 text-brand-900" : "border-line bg-surface text-ink-muted"}`}>
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={on}
                      disabled={readOnly}
                      onChange={(e) => setHours({ ...hours, days: e.target.checked ? [...hours.days, i].sort() : hours.days.filter((x) => x !== i) })}
                    />
                    {d}
                  </label>
                );
              })}
            </div>
            <div className="grid max-w-sm grid-cols-2 gap-3">
              <Field label="Desde">{(p) => <input {...p} type="time" value={hours.from} onChange={(e) => setHours({ ...hours, from: e.target.value })} className={inputClass} disabled={readOnly} />}</Field>
              <Field label="Hasta">{(p) => <input {...p} type="time" value={hours.to} onChange={(e) => setHours({ ...hours, to: e.target.value })} className={inputClass} disabled={readOnly} />}</Field>
            </div>
            {fe.businessHours && <p className="text-xs text-red-600">{fe.businessHours}</p>}
          </div>
        )}
      </fieldset>

      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      {!readOnly && (
        <div className="flex justify-end">
          <Button type="submit" loading={busy}>
            Guardar
          </Button>
        </div>
      )}
    </form>
  );
}
