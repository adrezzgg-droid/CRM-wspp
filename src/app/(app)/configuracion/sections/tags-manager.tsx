"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Tag, Trash2 } from "lucide-react";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import { Alert, Button, Field, inputClass, Modal } from "@/components/ui/controls";
import { TagChip } from "@/components/ui/badges";

type TagRow = { id: string; name: string; color: string };

const PALETTE = ["#2a9781", "#16a34a", "#65a30d", "#ca8a04", "#ea580c", "#dc2626", "#db2777", "#7c3aed", "#2563eb", "#0891b2", "#475569"];

function TagModal({ tag, onClose }: { tag?: TagRow; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(tag?.name ?? "");
  const [color, setColor] = useState(tag?.color ?? PALETTE[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFe({});
    try {
      if (tag) await api("PATCH", `/api/tags/${tag.id}`, { name, color });
      else await api("POST", "/api/tags", { name, color });
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
      title={tag ? "Editar etiqueta" : "Nueva etiqueta"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="tag-form" loading={busy}>
            Guardar
          </Button>
        </>
      }
    >
      <form id="tag-form" onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert>{error}</Alert>}
        <Field label="Nombre *" error={fe.name} hint="Se guarda en mayúsculas.">
          {(p) => <input {...p} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} className={inputClass} />}
        </Field>
        <fieldset>
          <legend className="mb-1 text-sm font-medium">Color</legend>
          <div className="flex flex-wrap items-center gap-2">
            {PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={`Color ${c}`}
                aria-pressed={color === c}
                className={`size-7 rounded-full ring-offset-2 ${color === c ? "ring-2 ring-ink" : ""}`}
                style={{ background: c }}
              />
            ))}
            <label className="ml-1 flex items-center gap-1.5 text-xs text-ink-muted">
              Otro
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-7 w-9 cursor-pointer rounded border border-line" />
            </label>
          </div>
          {fe.color && <p className="mt-1 text-xs text-red-600">{fe.color}</p>}
        </fieldset>
        <p className="text-sm">
          Vista previa: <TagChip name={(name || "ETIQUETA").toUpperCase()} color={color} />
        </p>
      </form>
    </Modal>
  );
}

export function TagsManager({ tags, canCreate, canEdit, canDelete }: { tags: TagRow[]; canCreate: boolean; canEdit: boolean; canDelete: boolean }) {
  const router = useRouter();
  const [modal, setModal] = useState<{ tag?: TagRow } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(t: TagRow) {
    if (!window.confirm(`¿Eliminar la etiqueta ${t.name}? Deja de mostrarse en clientes y conversaciones.`)) return;
    setError(null);
    try {
      await api("DELETE", `/api/tags/${t.id}`);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="space-y-3">
      {canCreate && (
        <div className="flex justify-end">
          <Button onClick={() => setModal({})}>
            <Plus className="size-4" aria-hidden /> Nueva etiqueta
          </Button>
        </div>
      )}
      {error && <Alert>{error}</Alert>}
      {tags.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-surface px-6 py-10 text-center text-sm text-ink-muted">
          <Tag className="mx-auto mb-2 size-7" aria-hidden />
          Todavía no hay etiquetas.
        </div>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
          {tags.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="flex-1">
                <TagChip name={t.name} color={t.color} />
              </span>
              {canEdit && (
                <button type="button" onClick={() => setModal({ tag: t })} className="rounded p-1.5 text-ink-muted hover:bg-canvas" aria-label={`Editar ${t.name}`}>
                  <Pencil className="size-4" aria-hidden />
                </button>
              )}
              {canDelete && (
                <button type="button" onClick={() => remove(t)} className="rounded p-1.5 text-ink-muted hover:bg-red-50 hover:text-red-600" aria-label={`Eliminar ${t.name}`}>
                  <Trash2 className="size-4" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {modal && <TagModal tag={modal.tag} onClose={() => setModal(null)} />}
    </div>
  );
}
