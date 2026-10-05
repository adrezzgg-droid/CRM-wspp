"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2, UsersRound } from "lucide-react";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import { Alert, Button, CheckboxGroup, Field, inputClass, Modal } from "@/components/ui/controls";

export interface TeamRow {
  id: string;
  name: string;
  leaderIds: string[];
  memberIds: string[];
}

type Person = { id: string; name: string; canLead: boolean };

function TeamModal({ team, people, onClose }: { team?: TeamRow; people: Person[]; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(team?.name ?? "");
  const [leaderIds, setLeaderIds] = useState(team?.leaderIds ?? []);
  const [memberIds, setMemberIds] = useState(team?.memberIds ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFe({});
    try {
      const body = { name, leaderIds, memberIds: memberIds.filter((id) => !leaderIds.includes(id)) };
      if (team) await api("PATCH", `/api/teams/${team.id}`, body);
      else await api("POST", "/api/teams", body);
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
      title={team ? "Editar equipo" : "Nuevo equipo"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="team-form" loading={busy}>
            Guardar
          </Button>
        </>
      }
    >
      <form id="team-form" onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert>{error}</Alert>}
        <Field label="Nombre *" error={fe.name}>
          {(p) => <input {...p} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />}
        </Field>
        <div>
          <p className="mb-1 text-sm font-medium">Supervisores (líderes)</p>
          <CheckboxGroup
            options={people.filter((p) => p.canLead).map((p) => ({ id: p.id, label: p.name }))}
            value={leaderIds}
            onChange={setLeaderIds}
            empty="No hay supervisores ni administradores activos."
          />
          {fe.leaderIds && <p className="mt-1 text-xs text-red-600">{fe.leaderIds}</p>}
        </div>
        <div>
          <p className="mb-1 text-sm font-medium">Integrantes</p>
          <CheckboxGroup
            options={people.filter((p) => !leaderIds.includes(p.id)).map((p) => ({ id: p.id, label: p.name }))}
            value={memberIds}
            onChange={setMemberIds}
            empty="No hay usuarios activos."
          />
          {fe.memberIds && <p className="mt-1 text-xs text-red-600">{fe.memberIds}</p>}
        </div>
        <p className="text-xs text-ink-muted">Los supervisores ven y reparten los clientes y conversaciones de los integrantes de sus equipos.</p>
      </form>
    </Modal>
  );
}

export function TeamsManager({ teams, people, names, canEdit, canDelete }: { teams: TeamRow[]; people: Person[]; names: Record<string, string>; canEdit: boolean; canDelete: boolean }) {
  const router = useRouter();
  const [modal, setModal] = useState<{ team?: TeamRow } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(t: TeamRow) {
    if (!window.confirm(`¿Eliminar el equipo ${t.name}? Los usuarios no se borran.`)) return;
    setError(null);
    try {
      await api("DELETE", `/api/teams/${t.id}`);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const list = (ids: string[]) => ids.map((id) => names[id] ?? "usuario eliminado").join(", ") || "—";

  return (
    <div className="space-y-3">
      {canEdit && (
        <div className="flex justify-end">
          <Button onClick={() => setModal({})}>
            <Plus className="size-4" aria-hidden /> Nuevo equipo
          </Button>
        </div>
      )}
      {error && <Alert>{error}</Alert>}
      {teams.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-surface px-6 py-10 text-center text-sm text-ink-muted">
          <UsersRound className="mx-auto mb-2 size-7" aria-hidden />
          Todavía no hay equipos.
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {teams.map((t) => (
            <li key={t.id} className="rounded-xl border border-line bg-surface p-4">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-medium">{t.name}</h3>
                <div className="flex shrink-0">
                  {canEdit && (
                    <button type="button" onClick={() => setModal({ team: t })} className="rounded p-1.5 text-ink-muted hover:bg-canvas" aria-label={`Editar ${t.name}`}>
                      <Pencil className="size-4" aria-hidden />
                    </button>
                  )}
                  {canDelete && (
                    <button type="button" onClick={() => remove(t)} className="rounded p-1.5 text-ink-muted hover:bg-red-50 hover:text-red-600" aria-label={`Eliminar ${t.name}`}>
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  )}
                </div>
              </div>
              <dl className="mt-2 space-y-1 text-sm">
                <div>
                  <dt className="inline text-ink-muted">Supervisa: </dt>
                  <dd className="inline">{list(t.leaderIds)}</dd>
                </div>
                <div>
                  <dt className="inline text-ink-muted">Integrantes: </dt>
                  <dd className="inline">{list(t.memberIds)}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}
      {modal && <TeamModal team={modal.team} people={people} onClose={() => setModal(null)} />}
    </div>
  );
}
