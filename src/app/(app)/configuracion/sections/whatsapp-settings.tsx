"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, PlugZap, Unplug } from "lucide-react";
import type { WhatsappSettingsView } from "@/server/whatsapp/service";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import { Alert, Button, Field } from "@/components/ui/controls";
import { inputClass } from "@/components/ui/styles";
import { Badge } from "@/components/ui/badges";

const CONNECTION = {
  sin_configurar: { label: "Sin conectar", tone: "neutral" },
  conectado: { label: "Conectado", tone: "brand" },
  error: { label: "Con error", tone: "danger" },
} as const;
const WEBHOOK = {
  sin_verificar: { label: "Webhook sin verificar", tone: "warn" },
  verificado: { label: "Webhook verificado", tone: "brand" },
  error: { label: "Webhook con error", tone: "danger" },
} as const;

export function CopyField({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Field label={label} hint={hint}>
      {(p) => (
        <div className="flex gap-2">
          <input {...p} readOnly value={value} className={`${inputClass} font-mono text-xs`} onFocus={(e) => e.target.select()} />
          <Button
            variant="secondary"
            aria-label={`Copiar ${label}`}
            onClick={async () => {
              await navigator.clipboard.writeText(value).catch(() => undefined);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
          </Button>
        </div>
      )}
    </Field>
  );
}

const when = (ms?: number) => (ms ? new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" }).format(ms) : "—");

export function WhatsappSettings({ initial }: { initial: WhatsappSettingsView }) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const a = view.account;
  const [v, setV] = useState({ phoneNumberId: a?.phoneNumberId ?? "", wabaId: a?.wabaId ?? "", accessToken: "", appSecret: "", clearAppSecret: false });
  const [busy, setBusy] = useState<null | "save" | "test" | "disconnect">(null);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});
  const connected = !!a?.tokenSet;
  const readOnly = !view.canEdit;

  async function run(kind: "save" | "test" | "disconnect", fn: () => Promise<WhatsappSettingsView>, ok: string) {
    setBusy(kind);
    setMessage(null);
    setFe({});
    try {
      const next = await fn();
      setView(next);
      setV((s) => ({ ...s, accessToken: "", appSecret: "", clearAppSecret: false }));
      setMessage({ tone: "success", text: ok });
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
        Esta es la empresa de demostración: nunca se conecta a Meta y los mensajes se simulan desde la bandeja. Para usar WhatsApp de verdad, creá tu empresa real
        y conectá el número desde esta misma sección.
      </Alert>
    );
  }

  return (
    <div className="space-y-5">
      {!view.encryptionReady && (
        <Alert>El servidor no tiene configurada SECRETS_ENCRYPTION_KEY. Sin esa clave no se pueden guardar las credenciales de WhatsApp (ver .env.example).</Alert>
      )}
      {message && <Alert tone={message.tone}>{message.text}</Alert>}

      {/* Estado */}
      <section className="rounded-xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="mr-auto text-sm font-semibold">{a?.displayPhone && connected ? a.displayPhone : "Número de WhatsApp"}</h3>
          <Badge tone={CONNECTION[a?.connectionStatus ?? "sin_configurar"].tone}>{CONNECTION[a?.connectionStatus ?? "sin_configurar"].label}</Badge>
          {connected && <Badge tone={WEBHOOK[a!.webhookStatus].tone}>{WEBHOOK[a!.webhookStatus].label}</Badge>}
        </div>
        {connected ? (
          <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className="text-xs text-ink-muted">Nombre verificado</dt>
              <dd>{a!.verifiedName ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">Calidad según Meta</dt>
              <dd>{a!.qualityRating ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">Token cargado</dt>
              <dd className="font-mono text-xs">{a!.tokenLast4 ? `…${a!.tokenLast4}` : "Sí"}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">Última prueba</dt>
              <dd>{when(a!.lastCheckedAt)}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">Último webhook recibido</dt>
              <dd>{when(a!.lastWebhookAt)}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">Firma del webhook</dt>
              <dd>{a!.appSecretSet ? "App Secret propio de la empresa" : "App de la plataforma"}</dd>
            </div>
          </dl>
        ) : (
          <p className="mt-2 text-sm text-ink-muted">Todavía no hay un número conectado. Completá los datos de abajo: el CRM los prueba contra Meta antes de guardarlos.</p>
        )}
        {a?.lastError && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{a.lastError}</p>}
        {connected && !readOnly && (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="secondary" loading={busy === "test"} onClick={() => run("test", () => api("POST", "/api/settings/whatsapp/test"), "Conexión probada: Meta responde bien.")}>
              <PlugZap className="size-4" aria-hidden /> Probar conexión
            </Button>
            <Button
              variant="ghost"
              loading={busy === "disconnect"}
              onClick={() =>
                window.confirm("¿Desconectar WhatsApp? Se borran el token y la configuración del webhook. Las conversaciones quedan.") &&
                run("disconnect", () => api("DELETE", "/api/settings/whatsapp"), "WhatsApp desconectado.")
              }
            >
              <Unplug className="size-4" aria-hidden /> Desconectar
            </Button>
          </div>
        )}
      </section>

      {/* Datos de la cuenta */}
      {!readOnly && (
        <form
          className="space-y-4 rounded-xl border border-line bg-surface p-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            run("save", () => api("PUT", "/api/settings/whatsapp", v), connected ? "Datos actualizados y probados contra Meta." : "¡Listo! El número quedó conectado.");
          }}
        >
          <h3 className="text-sm font-semibold">{connected ? "Actualizar datos" : "Conectar el número"}</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Phone Number ID *" error={fe.phoneNumberId} hint="Meta for Developers → WhatsApp → Configuración de la API.">
              {(p) => <input {...p} inputMode="numeric" value={v.phoneNumberId} onChange={(e) => setV((s) => ({ ...s, phoneNumberId: e.target.value }))} className={`${inputClass} font-mono`} />}
            </Field>
            <Field label="WABA ID *" error={fe.wabaId} hint="Identificador de la cuenta de WhatsApp Business (misma pantalla).">
              {(p) => <input {...p} inputMode="numeric" value={v.wabaId} onChange={(e) => setV((s) => ({ ...s, wabaId: e.target.value }))} className={`${inputClass} font-mono`} />}
            </Field>
            <Field
              label={connected ? "Access Token (dejalo vacío para conservar el actual)" : "Access Token *"}
              error={fe.accessToken}
              hint="Token permanente de un usuario del sistema (Business Manager → Usuarios del sistema), con permisos whatsapp_business_messaging y whatsapp_business_management. Se guarda cifrado y no se vuelve a mostrar."
              className="sm:col-span-2"
            >
              {(p) => <input {...p} type="password" autoComplete="off" value={v.accessToken} onChange={(e) => setV((s) => ({ ...s, accessToken: e.target.value }))} className={`${inputClass} font-mono`} placeholder={a?.tokenLast4 ? `Guardado (…${a.tokenLast4})` : "EAAG…"} />}
            </Field>
            <Field
              label={view.platformSecretReady ? "App Secret propio (opcional)" : "App Secret de tu app de Meta *"}
              error={fe.appSecret}
              hint={
                view.platformSecretReady
                  ? "Solo si la empresa usa su propia app de Meta. Si no, la firma se valida con la app de la plataforma."
                  : "Configuración de la app → Básica → Clave secreta de la app. Valida que los webhooks vengan de Meta."
              }
              className="sm:col-span-2"
            >
              {(p) => <input {...p} type="password" autoComplete="off" value={v.appSecret} onChange={(e) => setV((s) => ({ ...s, appSecret: e.target.value, clearAppSecret: false }))} className={`${inputClass} font-mono`} placeholder={a?.appSecretSet ? "Guardado (dejalo vacío para conservarlo)" : ""} />}
            </Field>
            {a?.appSecretSet && view.platformSecretReady && (
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input type="checkbox" checked={v.clearAppSecret} onChange={(e) => setV((s) => ({ ...s, clearAppSecret: e.target.checked, appSecret: "" }))} className="size-4 accent-brand-600" />
                Dejar de usar el App Secret propio (pasar a la app de la plataforma)
              </label>
            )}
          </div>
          <div className="flex justify-end">
            <Button type="submit" loading={busy === "save"} disabled={!view.encryptionReady}>
              {connected ? "Guardar y probar" : "Conectar"}
            </Button>
          </div>
        </form>
      )}

      {/* Webhook */}
      <section className="space-y-4 rounded-xl border border-line bg-surface p-4">
        <div>
          <h3 className="text-sm font-semibold">Webhook (para recibir mensajes)</h3>
          <p className="mt-1 text-sm text-ink-muted">
            En Meta for Developers → tu app → WhatsApp → Configuración → Webhook, pegá estos datos y suscribí los campos <code className="rounded bg-canvas px-1">messages</code> y{" "}
            <code className="rounded bg-canvas px-1">message_template_status_update</code>.
          </p>
        </div>
        <CopyField label="URL de devolución de llamada" value={view.webhookUrl} hint={view.webhookUrl.startsWith("/") ? "Definí APP_URL con la dirección pública (https) del CRM." : undefined} />
        {view.verifyToken ? (
          <CopyField label="Verify Token" value={view.verifyToken} hint="Generado por el CRM para esta empresa." />
        ) : (
          <p className="text-sm text-ink-muted">El Verify Token se genera al conectar el número.</p>
        )}
      </section>

      <details className="rounded-xl border border-line bg-surface p-4 text-sm">
        <summary className="cursor-pointer font-medium">Cómo conseguir estos datos</summary>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-ink-muted">
          <li>En business.facebook.com, verificá tu empresa (sin eso Meta limita los envíos).</li>
          <li>En developers.facebook.com creá una app de tipo Empresa y agregale el producto WhatsApp.</li>
          <li>En WhatsApp → Configuración de la API vas a ver el Phone Number ID y el WABA ID. Para empezar podés usar el número de prueba que da Meta.</li>
          <li>Para producción, agregá tu número (no puede estar en uso en la app común de WhatsApp).</li>
          <li>En Business Manager → Usuarios del sistema, creá un usuario, asignale la app y la cuenta de WhatsApp, y generá un token permanente con los permisos indicados.</li>
          <li>Pegá todo acá y tocá Conectar. Después configurá el webhook con la URL y el Verify Token de arriba.</li>
        </ol>
      </details>
    </div>
  );
}
