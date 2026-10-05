"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MapPinned, Pencil, Plus, Trash2 } from "lucide-react";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import { Alert, Button, CheckboxGroup, Field, inputClass, Modal } from "@/components/ui/controls";

type ZoneRow = { id: string; name: string; localities: string[]; sellerIds: string[]; customers: number };
type Seller = { id: string; name: string; available: boolean };

function ZoneModal({ zone, sellers, onClose }: { zone?: ZoneRow; sellers: Seller[]; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(zone?.name ?? "");
  const [localities, setLocalities] = useState((zone?.localities ?? []).join(", "));
  const [sellerIds, setSellerIds] = useState(zone?.sellerIds ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFe({});
    const body = {
      name,
      localities: localities.split(/[,\n]/).map((l) => l.trim()).filter(Boolean),
      sellerIds,
    };
    try {
      if (zone) await api("PATCH", `/api/zones/${zone.id}`, body);
      else await api("POST", "/api/zones", body);
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
      title={zone ? "Editar zona" : "Nueva zona"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="zone-form" loading={busy}>
            Guardar
          </Button>
        </>
      }
    >
      <form id="zone-form" onSubmit={submit} className="space-y-4" noValidate>
        {error && <Alert>{error}</Alert>}
        <Field label="Nombre *" error={fe.name}>
          {(p) => <input {...p} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="Centro, Norte, Zona Sur…" />}
        </Field>
        <Field label="Localidades o barrios" error={fe.localities} hint="Separadas por coma.">
          {(p) => <textarea {...p} value={localities} onChange={(e) => setLocalities(e.target.value)} rows={2} className={inputClass} placeholder="Córdoba Capital, Villa Allende" />}
        </Field>
        <div>
          <p className="mb-1 text-sm font-medium">Vendedores que la cubren</p>
          <CheckboxGroup
            options={sellers.map((s) => ({ id: s.id, label: s.available ? s.name : `${s.name} (no disponible)` }))}
            value={sellerIds}
            onChange={setSellerIds}
            empty="No hay vendedores activos."
          />
          {fe.sellerIds && <p className="mt-1 text-xs text-red-600">{fe.sellerIds}</p>}
          <p className="mt-2 text-xs text-ink-muted">Los clientes nuevos con esta zona se reparten entre estos vendedores por turno.</p>
        </div>
      </form>
    </Modal>
  );
}

export function ZonesManager({ zones, sellers, names, canEdit }: { zones: ZoneRow[]; sellers: Seller[]; names: Record<string, string>; canEdit: boolean }) {
  const router = useRouter();
  const [modal, setModal] = useState<{ zone?: ZoneRow } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(z: ZoneRow) {
    if (!window.confirm(`¿Eliminar la zona ${z.name}?`)) return;
    setError(null);
    try {
      await api("DELETE", `/api/zones/${z.id}`);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="space-y-3">
      {canEdit && (
        <div className="flex justify-end">
          <Button onClick={() => setModal({})}>
            <Plus className="size-4" aria-hidden /> Nueva zona
          </Button>
        </div>
      )}
      {error && <Alert>{error}</Alert>}
      {zones.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-surface px-6 py-10 text-center text-sm text-ink-muted">
          <MapPinned className="mx-auto mb-2 size-7" aria-hidden />
          Todavía no hay zonas.
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {zones.map((z) => (
            <li key={z.id} className="rounded-xl border border-line bg-surface p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-medium">{z.name}</h3>
                  <p className="text-xs text-ink-muted">{z.customers === 1 ? "1 cliente" : `${z.customers} clientes`}</p>
                </div>
                {canEdit && (
                  <div className="flex shrink-0">
                    <button type="button" onClick={() => setModal({ zone: z })} className="rounded p-1.5 text-ink-muted hover:bg-canvas" aria-label={`Editar ${z.name}`}>
                      <Pencil className="size-4" aria-hidden />
                    </button>
                    <button type="button" onClick={() => remove(z)} className="rounded p-1.5 text-ink-muted hover:bg-red-50 hover:text-red-600" aria-label={`Eliminar ${z.name}`}>
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  </div>
                )}
              </div>
              <dl className="mt-2 space-y-1 text-sm">
                <div>
                  <dt className="inline text-ink-muted">Localidades: </dt>
                  <dd className="inline">{z.localities.join(", ") || "—"}</dd>
                </div>
                <div>
                  <dt className="inline text-ink-muted">Vendedores: </dt>
                  <dd className="inline">{z.sellerIds.map((id) => names[id] ?? "—").join(", ") || <span className="text-amber-700">ninguno</span>}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}
      {modal && <ZoneModal zone={modal.zone} sellers={sellers} onClose={() => setModal(null)} />}
    </div>
  );
}
