"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { NotificationType } from "@/types/model";
import { NOTIFICATION_TYPE_LABELS } from "@/types/model";
import { api, errorMessage } from "@/lib/api-client";
import { Alert, Button } from "@/components/ui/controls";

const HINTS: Record<NotificationType, string> = {
  nuevo_lead: "Un número nuevo te escribe o te asignan un lead.",
  nuevo_mensaje: "Un cliente tuyo escribe y queda esperando respuesta.",
  lead_sin_responder: "Un lead lleva más del tiempo máximo sin primera respuesta.",
  tarea_vencida: "Se pasó la hora de una tarea tuya.",
  cliente_esperando: "Un cliente ya atendido lleva más del tiempo máximo esperando.",
  nueva_asignacion: "Te asignan una conversación, una tarea o una entrega.",
  pedido_generado: "Un pedido que vendiste fue entregado.",
  cliente_reactivar: "Un cliente tuyo pasa a estar para reactivar.",
  automatizacion: "Una automatización te envía un aviso.",
};

export function NotificationPrefsForm({ types, initial }: { types: NotificationType[]; initial: Partial<Record<NotificationType, boolean>> }) {
  const router = useRouter();
  const [prefs, setPrefs] = useState(() => Object.fromEntries(types.map((t) => [t, initial[t] !== false])) as Record<NotificationType, boolean>);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      await api("PUT", "/api/me/notifications", { prefs });
      setMessage({ tone: "success", text: "Preferencias guardadas." });
      router.refresh();
    } catch (err) {
      setMessage({ tone: "error", text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 rounded-xl border border-line bg-surface p-4">
      <p className="text-sm text-ink-muted">Elegí qué avisos querés recibir en la campana. Es una preferencia personal: no cambia la de nadie más.</p>
      <ul className="divide-y divide-line">
        {types.map((t) => (
          <li key={t}>
            <label className="flex cursor-pointer items-start gap-3 py-3">
              <input
                type="checkbox"
                role="switch"
                checked={prefs[t]}
                onChange={(e) => setPrefs((p) => ({ ...p, [t]: e.target.checked }))}
                className="mt-0.5 size-4 shrink-0 accent-brand-600"
              />
              <span>
                <span className="block text-sm font-medium">{NOTIFICATION_TYPE_LABELS[t]}</span>
                <span className="block text-xs text-ink-muted">{HINTS[t]}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      <div className="flex justify-end">
        <Button onClick={save} loading={busy}>
          Guardar
        </Button>
      </div>
    </div>
  );
}
