"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCw, Send } from "lucide-react";
import type { IntegrationsView } from "@/server/connectors/service";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import { Alert, Button, Field } from "@/components/ui/controls";
import { inputClass } from "@/components/ui/styles";
import { Badge } from "@/components/ui/badges";
import { CopyField } from "./whatsapp-settings";

const EVENT_LABELS: Record<string, string> = {
  "order.confirmed": "Pedido confirmado",
  "order.cancelled": "Pedido cancelado (si ya se había enviado)",
  ping: "Prueba",
};
const STATUS = {
  pendiente: { label: "Pendiente", tone: "warn" },
  enviado: { label: "Entregado", tone: "brand" },
  error: { label: "Con error", tone: "danger" },
} as const;

const when = (ms?: number | null) => (ms ? new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" }).format(ms) : "—");

export function IntegrationsSettings({ initial }: { initial: IntegrationsView }) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const g = view.gestion;
  const [v, setV] = useState({ enabled: g.enabled, url: g.url, events: g.events });
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});

  async function run<T>(key: string, fn: () => Promise<T>, ok: (r: T) => string) {
    setBusy(key);
    setMessage(null);
    setFe({});
    try {
      const r = await fn();
      if (r && typeof r === "object" && "gestion" in r) setView(r as unknown as IntegrationsView);
      setMessage({ tone: "success", text: ok(r) });
      router.refresh();
    } catch (err) {
      setMessage({ tone: "error", text: errorMessage(err) });
      if (err instanceof ApiClientError) setFe(err.fieldErrors);
    } finally {
      setBusy(null);
    }
  }

  if (view.isDemo) {
    return (
      <Alert tone="info">
        La empresa de demostración no se conecta con otros sistemas: así un pedido de prueba nunca llega a tu sistema de gestión real. Configurá el conector desde tu empresa real.
      </Alert>
    );
  }

  const save = (regenerateSecret: boolean) =>
    run(regenerateSecret ? "secret" : "save", () => api<IntegrationsView>("PUT", "/api/settings/integrations", { ...v, regenerateSecret }), () =>
      regenerateSecret ? "Secreto nuevo generado: cargalo también en el sistema de gestión." : "Conector guardado.",
    );

  return (
    <div className="space-y-5">
      {!view.encryptionReady && <Alert>El servidor no tiene SECRETS_ENCRYPTION_KEY: no se puede guardar el secreto del conector.</Alert>}
      {message && <Alert tone={message.tone}>{message.text}</Alert>}

      <section className="space-y-4 glass-card rounded-xl p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="mr-auto text-sm font-semibold">Sistema de gestión de la distribuidora</h3>
          <Badge tone={g.enabled ? "brand" : "neutral"}>{g.enabled ? "Activo" : "Apagado"}</Badge>
        </div>
        <p className="text-sm text-ink-muted">
          Cada pedido confirmado se manda al sistema de gestión para prepararlo y repartirlo; el sistema de gestión devuelve el estado del reparto. Los envíos se firman con
          un secreto compartido y se reintentan solos si el otro lado no responde.
        </p>
        <form
          className="space-y-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            save(false);
          }}
        >
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={v.enabled} disabled={!view.canEdit} onChange={(e) => setV((s) => ({ ...s, enabled: e.target.checked }))} className="size-4 accent-brand-600" />
            Enviar pedidos al sistema de gestión
          </label>
          <Field label="Dirección donde el sistema de gestión recibe los pedidos *" error={fe.url} hint="https://… (la provee quien administra el sistema de gestión).">
            {(p) => <input {...p} type="url" disabled={!view.canEdit} value={v.url} onChange={(e) => setV((s) => ({ ...s, url: e.target.value }))} className={`${inputClass} font-mono text-xs`} placeholder="https://gestion.midistribuidora.com/api/crm/pedidos" />}
          </Field>
          <fieldset>
            <legend className="mb-1 text-sm font-medium">Qué enviar</legend>
            <div className="space-y-1">
              {(["order.confirmed", "order.cancelled"] as const).map((ev) => (
                <label key={ev} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    disabled={!view.canEdit}
                    checked={v.events.includes(ev)}
                    onChange={(e) => setV((s) => ({ ...s, events: e.target.checked ? [...s.events, ev] : s.events.filter((x) => x !== ev) }))}
                    className="size-4 accent-brand-600"
                  />
                  {EVENT_LABELS[ev]}
                </label>
              ))}
            </div>
            {fe.events && <p className="mt-1 text-xs text-red-600">{fe.events}</p>}
          </fieldset>
          {view.canEdit && (
            <div className="flex flex-wrap justify-end gap-2">
              {g.url && (
                <Button variant="secondary" loading={busy === "test"} onClick={() => run("test", () => api<{ status: number }>("POST", "/api/settings/integrations/test"), (r) => `El sistema de gestión respondió ${r.status}: la conexión y la firma funcionan.`)}>
                  <Send className="size-4" aria-hidden /> Enviar prueba
                </Button>
              )}
              <Button type="submit" loading={busy === "save"} disabled={!view.encryptionReady}>
                Guardar
              </Button>
            </div>
          )}
        </form>
      </section>

      <section className="space-y-4 glass-card rounded-xl p-4">
        <h3 className="text-sm font-semibold">Datos para configurar en el sistema de gestión</h3>
        {g.secret ? (
          <CopyField label="Secreto compartido" value={g.secret} hint="Con este secreto el sistema de gestión verifica que los pedidos vienen del CRM y firma lo que nos devuelve (HMAC-SHA256)." />
        ) : (
          <p className="text-sm text-ink-muted">El secreto compartido se genera al guardar el conector.</p>
        )}
        <CopyField label="Dirección para informar el estado del reparto" value={g.inboundUrl} hint="POST firmado con { orderId o number, status, externalId }. Ver docs/CONECTOR-GESTION.md." />
        {g.secret && view.canEdit && (
          <Button variant="ghost" loading={busy === "secret"} onClick={() => window.confirm("¿Generar un secreto nuevo? El sistema de gestión va a dejar de aceptar los envíos hasta que cargues el nuevo.") && save(true)}>
            <RotateCw className="size-4" aria-hidden /> Generar secreto nuevo
          </Button>
        )}
      </section>

      <section className="glass-card rounded-xl">
        <h3 className="border-b border-line px-4 py-3 text-sm font-semibold">Últimos envíos</h3>
        {view.outbox.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-ink-muted">Todavía no se envió nada.</p>
        ) : (
          <ul className="divide-y divide-line">
            {view.outbox.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                <Badge tone={STATUS[o.status].tone}>{STATUS[o.status].label}</Badge>
                <span className="font-medium">{o.number ?? "—"}</span>
                <span className="text-ink-muted">{EVENT_LABELS[o.event] ?? o.event}</span>
                <span className="text-xs text-ink-muted">{o.status === "enviado" ? `entregado ${when(o.deliveredAt)}` : `creado ${when(o.createdAt)} · ${o.attempts} intento(s)`}</span>
                {o.status === "pendiente" && o.attempts > 0 && <span className="text-xs text-ink-muted">próximo intento {when(o.nextAttemptAt)}</span>}
                {o.lastError && o.status !== "enviado" && <span className="w-full text-xs text-red-700">{o.lastError}</span>}
                {o.status === "error" && view.canEdit && (
                  <Button variant="secondary" className="ml-auto px-2.5 py-1 text-xs" loading={busy === o.id} onClick={() => run(o.id, () => api<{ sent: number }>("POST", `/api/settings/integrations/outbox/${o.id}/retry`), (r) => (r.sent ? "Enviado." : "Sigue sin poder enviarse: revisá el error."))}>
                    Reintentar
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
