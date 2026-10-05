"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import type { Order } from "@/types/model";
import { orderTotal, round2 } from "@/lib/orders";
import { normalizeText } from "@/lib/search";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import { Alert, Button, Field, inputClass, Modal } from "@/components/ui/controls";
import { CustomerPicker, type PickedCustomer } from "./customer-picker";

export type ProductOption = { id: string; name: string; sku?: string; unit: string; price: number };

type Line = { key: number; productId: string; qty: string; unitPrice: string };

let seq = 0;
const newLine = (): Line => ({ key: ++seq, productId: "", qty: "1", unitPrice: "" });

/**
 * Alta de pedido: cliente, líneas de productos (precio de lista editable),
 * entrega y notas. Se guarda como borrador o confirmado.
 */
export function OrderFormModal({
  open,
  onClose,
  products,
  currency,
  customer,
  context,
}: {
  open: boolean;
  onClose: () => void;
  products: ProductOption[];
  currency: string;
  customer?: PickedCustomer;
  context?: { conversationId?: string; leadId?: string; opportunityId?: string };
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<PickedCustomer | null>(customer ?? null);
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [address, setAddress] = useState(customer?.address ?? "");
  const [date, setDate] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<"draft" | "confirm" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const money = useMemo(() => new Intl.NumberFormat("es-AR", { style: "currency", currency }), [currency]);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const visibleProducts = useMemo(() => {
    const t = normalizeText(filter);
    return t ? products.filter((p) => normalizeText(`${p.name} ${p.sku ?? ""}`).includes(t)) : products;
  }, [filter, products]);

  const resolved = lines.map((l) => {
    const p = byId.get(l.productId);
    const qty = Number(l.qty);
    const unitPrice = l.unitPrice === "" ? (p?.price ?? 0) : Number(l.unitPrice);
    return { l, p, qty, unitPrice, subtotal: p && qty > 0 ? round2(qty * unitPrice) : 0 };
  });
  const total = orderTotal(resolved.filter((r) => r.p && r.qty > 0).map((r) => ({ qty: r.qty, unitPrice: r.unitPrice })));

  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  async function save(confirm: boolean) {
    if (!picked) {
      setError("Elegí el cliente.");
      return;
    }
    const items = resolved
      .filter((r) => r.p)
      .map((r) => ({ productId: r.p!.id, qty: r.qty, ...(r.l.unitPrice !== "" ? { unitPrice: r.unitPrice } : {}) }));
    if (!items.length) {
      setError("Agregá al menos un producto.");
      return;
    }
    setBusy(confirm ? "confirm" : "draft");
    setError(null);
    try {
      const res = await api<{ order: Order }>("POST", "/api/orders", {
        customerId: picked.id,
        items,
        deliveryAddress: address,
        deliveryDate: date ? new Date(`${date}T12:00:00`).getTime() : undefined,
        notes,
        confirm,
        ...context,
      });
      onClose();
      router.push(`/pedidos/${res.order.id}`);
    } catch (err) {
      setError(err instanceof ApiClientError && Object.keys(err.fieldErrors).length ? `${errorMessage(err)}: revisá los productos.` : errorMessage(err));
      setBusy(null);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nuevo pedido"
      size="lg"
      footer={
        <>
          <span className="mr-auto self-center text-sm">
            Total: <strong>{money.format(total)}</strong>
          </span>
          <Button variant="secondary" onClick={() => save(false)} loading={busy === "draft"} disabled={!!busy}>
            Guardar borrador
          </Button>
          <Button onClick={() => save(true)} loading={busy === "confirm"} disabled={!!busy}>
            Confirmar pedido
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <div>
          <p className="mb-1 text-sm font-medium">Cliente *</p>
          {customer ? (
            <p className="rounded-lg bg-canvas px-3 py-2 text-sm font-medium">{customer.name}</p>
          ) : (
            <CustomerPicker
              value={picked}
              onChange={(c) => {
                setPicked(c);
                if (c?.address && !address) setAddress(c.address);
              }}
            />
          )}
        </div>

        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium">Productos</legend>
          {products.length > 8 && (
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrar productos…" className={`${inputClass} py-1.5`} aria-label="Filtrar productos" />
          )}
          {products.length === 0 && <p className="text-sm text-ink-muted">No hay productos activos. Cargalos en Productos.</p>}
          <ul className="space-y-2">
            {resolved.map(({ l, p, subtotal }) => (
              <li key={l.key} className="grid grid-cols-[1fr_auto] gap-2 rounded-lg border border-line p-2 sm:grid-cols-[1fr_6rem_8rem_7rem_auto] sm:items-center sm:border-0 sm:p-0">
                <select value={l.productId} onChange={(e) => update(l.key, { productId: e.target.value, unitPrice: "" })} className={`${inputClass} col-span-2 sm:col-span-1`} aria-label="Producto">
                  <option value="">Elegí un producto…</option>
                  {(l.productId && !visibleProducts.some((x) => x.id === l.productId) ? [byId.get(l.productId)!, ...visibleProducts] : visibleProducts).map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name} · {money.format(x.price)}/{x.unit}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-1 text-xs text-ink-muted">
                  <input value={l.qty} onChange={(e) => update(l.key, { qty: e.target.value })} type="number" min={0} step="0.01" inputMode="decimal" className={inputClass} aria-label="Cantidad" />
                  {p?.unit}
                </label>
                <input
                  value={l.unitPrice}
                  onChange={(e) => update(l.key, { unitPrice: e.target.value })}
                  placeholder={p ? String(p.price) : "Precio"}
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  className={inputClass}
                  aria-label="Precio unitario"
                />
                <span className="self-center text-right text-sm font-medium">{money.format(subtotal)}</span>
                <button
                  type="button"
                  onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : [newLine()]))}
                  className="justify-self-end rounded p-1.5 text-ink-muted hover:bg-red-50 hover:text-red-600"
                  aria-label="Quitar línea"
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
          <Button variant="ghost" className="px-2" onClick={() => setLines((ls) => [...ls, newLine()])}>
            <Plus className="size-4" aria-hidden /> Agregar producto
          </Button>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Dirección de entrega">{(p) => <input {...p} value={address} onChange={(e) => setAddress(e.target.value)} className={inputClass} />}</Field>
          <Field label="Fecha de entrega">{(p) => <input {...p} value={date} onChange={(e) => setDate(e.target.value)} type="date" className={inputClass} />}</Field>
          <Field label="Notas" className="sm:col-span-2">
            {(p) => <textarea {...p} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inputClass} placeholder="Horario, forma de pago…" />}
          </Field>
        </div>
      </div>
    </Modal>
  );
}
