"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import type { Product } from "@/types/model";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import { Alert, Button, Field, inputClass, Modal } from "@/components/ui/controls";
import { Badge } from "@/components/ui/badges";

function ProductModal({ product, currency, onClose }: { product?: Product; currency: string; onClose: () => void }) {
  const router = useRouter();
  const [v, setV] = useState({
    name: product?.name ?? "",
    sku: product?.sku ?? "",
    unit: product?.unit ?? "kg",
    price: String(product?.price ?? ""),
    active: product?.active ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});
  const bind = (k: "name" | "sku" | "unit" | "price") => ({
    value: v[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setV((s) => ({ ...s, [k]: e.target.value })),
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFe({});
    const body = { ...v, price: Number(v.price || 0) };
    try {
      if (product) await api("PATCH", `/api/products/${product.id}`, body);
      else await api("POST", "/api/products", body);
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
      title={product ? "Editar producto" : "Nuevo producto"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="product-form" loading={busy}>
            Guardar
          </Button>
        </>
      }
    >
      <form id="product-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        {error && <div className="sm:col-span-2"><Alert>{error}</Alert></div>}
        <Field label="Nombre *" error={fe.name} className="sm:col-span-2">
          {(p) => <input {...p} {...bind("name")} className={inputClass} placeholder="Pechuga de pollo" />}
        </Field>
        <Field label="Código" error={fe.sku}>{(p) => <input {...p} {...bind("sku")} className={inputClass} placeholder="PEC-01" />}</Field>
        <Field label="Unidad *" error={fe.unit} hint="kg, unidad, caja, cajón…">
          {(p) => <input {...p} {...bind("unit")} className={inputClass} list="units" />}
        </Field>
        <datalist id="units">
          {["kg", "unidad", "caja", "cajón", "docena", "bolsa"].map((u) => (
            <option key={u} value={u} />
          ))}
        </datalist>
        <Field label={`Precio de lista (${currency}) *`} error={fe.price}>
          {(p) => <input {...p} {...bind("price")} type="number" min={0} step="0.01" inputMode="decimal" className={inputClass} />}
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input type="checkbox" checked={v.active} onChange={(e) => setV((s) => ({ ...s, active: e.target.checked }))} className="size-4 accent-brand-600" />
          Activo (se puede vender)
        </label>
      </form>
    </Modal>
  );
}

export function ProductsManager({ products, currency, canCreate, canEdit }: { products: Product[]; currency: string; canCreate: boolean; canEdit: boolean }) {
  const [modal, setModal] = useState<{ product?: Product } | null>(null);
  const money = new Intl.NumberFormat("es-AR", { style: "currency", currency });
  return (
    <>
      {canCreate && (
        <div className="flex justify-end">
          <Button onClick={() => setModal({})}>
            <Plus className="size-4" aria-hidden /> Nuevo producto
          </Button>
        </div>
      )}
      {products.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line bg-surface px-6 py-10 text-center text-sm text-ink-muted">No hay productos con esos filtros.</p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
          {products.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {p.name}
                  {!p.active && <Badge tone="neutral">Inactivo</Badge>}
                </p>
                <p className="text-xs text-ink-muted">{[p.sku, `por ${p.unit}`].filter(Boolean).join(" · ")}</p>
              </div>
              <p className="text-sm font-semibold whitespace-nowrap">{money.format(p.price)}</p>
              {canEdit && (
                <button type="button" onClick={() => setModal({ product: p })} className="rounded p-1.5 text-ink-muted hover:bg-canvas" aria-label={`Editar ${p.name}`}>
                  <Pencil className="size-4" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {modal && <ProductModal product={modal.product} currency={currency} onClose={() => setModal(null)} />}
    </>
  );
}
