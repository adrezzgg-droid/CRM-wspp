"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendPasswordResetEmail } from "firebase/auth";
import { Copy, KeyRound, Pencil, UserPlus } from "lucide-react";
import { ROLE_LABELS, ROLES, type Role } from "@/server/permissions/matrix";
import { firebaseClient } from "@/lib/firebase/client";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import { Alert, Button, CheckboxGroup, Field, inputClass, Modal } from "@/components/ui/controls";
import { Badge } from "@/components/ui/badges";

export interface MemberRow {
  id: string;
  displayName: string;
  email: string;
  phone?: string;
  role: Role;
  teamIds: string[];
  zoneIds: string[];
  active: boolean;
  available: boolean;
}

type Option = { id: string; name: string };

interface Props {
  members: MemberRow[];
  teams: Option[];
  zones: Option[];
  currentUid: string;
  currentRole: Role;
  canCreate: boolean;
  canEdit: boolean;
  canDeactivate: boolean;
}

function SetupLink({ email, link }: { email: string; link: string }) {
  const [copied, setCopied] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  async function copy() {
    await navigator.clipboard.writeText(link).catch(() => undefined);
    setCopied(true);
  }
  async function send() {
    try {
      await sendPasswordResetEmail(firebaseClient().auth, email);
      setSent(`Le enviamos el email a ${email}.`);
    } catch {
      setSent("No se pudo enviar el email. Compartí el enlace por otro medio.");
    }
  }
  return (
    <div className="space-y-2 rounded-lg border border-line bg-canvas p-3">
      <p className="text-sm">Con este enlace la persona define su contraseña y entra:</p>
      <input readOnly value={link} className={`${inputClass} font-mono text-xs`} onFocus={(e) => e.currentTarget.select()} aria-label="Enlace de acceso" />
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={copy}>
          <Copy className="size-4" aria-hidden /> {copied ? "Copiado" : "Copiar enlace"}
        </Button>
        <Button variant="secondary" onClick={send}>
          Enviar por email
        </Button>
      </div>
      {sent && <p className="text-xs text-ink-muted">{sent}</p>}
    </div>
  );
}

type FormValues = { email: string; displayName: string; phone: string; role: Role; teamIds: string[]; zoneIds: string[]; available: boolean };

function MemberModal({ member, props, onClose }: { member?: MemberRow; props: Props; onClose: () => void }) {
  const router = useRouter();
  const [v, setV] = useState<FormValues>({
    email: member?.email ?? "",
    displayName: member?.displayName ?? "",
    phone: member?.phone ?? "",
    role: member?.role ?? "vendedor",
    teamIds: member?.teamIds ?? [],
    zoneIds: member?.zoneIds ?? [],
    available: member?.available ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});
  const [created, setCreated] = useState<{ email: string; link: string } | null>(null);
  const isSelf = member?.id === props.currentUid;
  const roles = ROLES.filter((r) => r !== "admin" || props.currentRole === "admin");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFe({});
    try {
      if (member) {
        const { email: _email, ...rest } = v;
        void _email;
        await api("PATCH", `/api/members/${member.id}`, isSelf ? { ...rest, role: undefined } : rest);
        onClose();
        router.refresh();
      } else {
        const { available: _available, ...rest } = v;
        void _available;
        const res = await api<{ setupLink: string; member: { email: string } }>("POST", "/api/members", rest);
        setCreated({ email: res.member.email, link: res.setupLink });
        router.refresh();
      }
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiClientError) setFe(err.fieldErrors);
    } finally {
      setBusy(false);
    }
  }

  const bind = (k: "email" | "displayName" | "phone") => ({
    value: v[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setV((s) => ({ ...s, [k]: e.target.value })),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={member ? `Editar a ${member.displayName}` : "Nuevo usuario"}
      footer={
        created ? (
          <Button onClick={onClose}>Listo</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" form="member-form" loading={busy}>
              {member ? "Guardar" : "Crear usuario"}
            </Button>
          </>
        )
      }
    >
      {created ? (
        <div className="space-y-3">
          <Alert tone="success">Usuario creado. Todavía no tiene contraseña.</Alert>
          <SetupLink email={created.email} link={created.link} />
        </div>
      ) : (
        <form id="member-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
          {error && <div className="sm:col-span-2"><Alert>{error}</Alert></div>}
          <Field label="Nombre y apellido *" error={fe.displayName}>{(p) => <input {...p} {...bind("displayName")} className={inputClass} />}</Field>
          <Field label="Email *" error={fe.email} hint={member ? "El email no se puede cambiar." : undefined}>
            {(p) => <input {...p} {...bind("email")} type="email" className={inputClass} disabled={!!member} />}
          </Field>
          <Field label="Teléfono" error={fe.phone}>{(p) => <input {...p} {...bind("phone")} className={inputClass} inputMode="tel" />}</Field>
          <Field label="Rol" error={fe.role} hint={isSelf ? "No podés cambiar tu propio rol." : undefined}>
            {(p) => (
              <select {...p} value={v.role} onChange={(e) => setV((s) => ({ ...s, role: e.target.value as Role }))} className={inputClass} disabled={isSelf}>
                {(roles.includes(v.role) ? roles : [v.role, ...roles]).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <div className="sm:col-span-2">
            <p className="mb-1 text-sm font-medium">Equipos</p>
            <CheckboxGroup options={props.teams.map((t) => ({ id: t.id, label: t.name }))} value={v.teamIds} onChange={(teamIds) => setV((s) => ({ ...s, teamIds }))} empty="No hay equipos creados." />
          </div>
          <div className="sm:col-span-2">
            <p className="mb-1 text-sm font-medium">Zonas que atiende</p>
            <CheckboxGroup options={props.zones.map((z) => ({ id: z.id, label: z.name }))} value={v.zoneIds} onChange={(zoneIds) => setV((s) => ({ ...s, zoneIds }))} empty="No hay zonas creadas." />
          </div>
          {member && (
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" checked={v.available} onChange={(e) => setV((s) => ({ ...s, available: e.target.checked }))} className="size-4 accent-brand-600" />
              Disponible para recibir leads automáticamente
            </label>
          )}
        </form>
      )}
    </Modal>
  );
}

export function UsersManager(props: Props) {
  const router = useRouter();
  const [modal, setModal] = useState<{ member?: MemberRow } | null>(null);
  const [linkFor, setLinkFor] = useState<{ email: string; link: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const teamName = new Map(props.teams.map((t) => [t.id, t.name]));

  async function toggleActive(m: MemberRow) {
    const verb = m.active ? "dar de baja" : "reactivar";
    if (!window.confirm(`¿Seguro que querés ${verb} a ${m.displayName}?${m.active ? " No va a poder entrar; su historial se conserva." : ""}`)) return;
    setBusyId(m.id);
    setError(null);
    try {
      await api("POST", `/api/members/${m.id}/status`, { active: !m.active });
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function accessLink(m: MemberRow) {
    setBusyId(m.id);
    setError(null);
    try {
      const res = await api<{ setupLink: string }>("POST", `/api/members/${m.id}/setup-link`);
      setLinkFor({ email: m.email, link: res.setupLink });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  const sorted = [...props.members].sort((a, b) => Number(b.active) - Number(a.active) || a.displayName.localeCompare(b.displayName, "es"));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-ink-muted">{props.members.filter((m) => m.active).length} usuarios activos</p>
        {props.canCreate && (
          <Button onClick={() => setModal({})}>
            <UserPlus className="size-4" aria-hidden /> Nuevo usuario
          </Button>
        )}
      </div>
      {error && <Alert>{error}</Alert>}
      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
        {sorted.map((m) => (
          <li key={m.id} className={`flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center ${m.active ? "" : "bg-canvas/60"}`}>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                {m.displayName}
                {m.id === props.currentUid && <span className="text-xs font-normal text-ink-muted">(vos)</span>}
                <Badge tone={m.role === "admin" ? "brand" : "neutral"}>{ROLE_LABELS[m.role]}</Badge>
                {!m.active && <Badge tone="danger">Dado de baja</Badge>}
                {m.active && m.role === "vendedor" && !m.available && <Badge tone="warn">No disponible</Badge>}
              </p>
              <p className="truncate text-xs text-ink-muted">
                {m.email}
                {m.teamIds.length > 0 && ` · ${m.teamIds.map((t) => teamName.get(t) ?? t).join(", ")}`}
              </p>
            </div>
            {(props.canEdit || props.canDeactivate) && (
              <div className="flex flex-wrap gap-1">
                {props.canEdit && m.active && (
                  <>
                    <Button variant="ghost" onClick={() => setModal({ member: m })} aria-label={`Editar a ${m.displayName}`}>
                      <Pencil className="size-4" aria-hidden /> Editar
                    </Button>
                    <Button variant="ghost" onClick={() => accessLink(m)} loading={busyId === m.id} aria-label={`Enlace de acceso para ${m.displayName}`}>
                      <KeyRound className="size-4" aria-hidden /> Acceso
                    </Button>
                  </>
                )}
                {props.canDeactivate && m.id !== props.currentUid && (
                  <Button variant="ghost" onClick={() => toggleActive(m)} disabled={busyId === m.id}>
                    {m.active ? "Dar de baja" : "Reactivar"}
                  </Button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {modal && <MemberModal member={modal.member} props={props} onClose={() => setModal(null)} />}
      {linkFor && (
        <Modal open onClose={() => setLinkFor(null)} title="Enlace de acceso" footer={<Button onClick={() => setLinkFor(null)}>Listo</Button>}>
          <SetupLink email={linkFor.email} link={linkFor.link} />
        </Modal>
      )}
    </div>
  );
}
