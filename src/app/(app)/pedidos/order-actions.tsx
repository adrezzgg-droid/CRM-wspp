"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import type { OrderStatus } from "@/types/model";
import { ORDER_STATUS_LABELS } from "@/types/model";
import { api, errorMessage } from "@/lib/api-client";
import { Alert, Button, Field, inputClass, Modal } from "@/components/ui/controls";
import { OrderFormModal, type ProductOption } from "@/components/commercial/order-form";
import type { PickedCustomer } from "@/components/commercial/customer-picker";

/** Botón "Nuevo pedido" con su formulario (lista de pedidos, ficha del cliente, bandeja). */
export function NewOrderButton({
  products,
  currency,
  customer,
  context,
  variant = "primary",
  label = "Nuevo pedido",
  className = "",
}: {
  products: ProductOption[];
  currency: string;
  customer?: PickedCustomer;
  context?: { conversationId?: string; leadId?: string; opportunityId?: string };
  variant?: "primary" | "secondary" | "ghost";
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} className={className} onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden /> {label}
      </Button>
      {open && <OrderFormModal open onClose={() => setOpen(false)} products={products} currency={currency} customer={customer} context={context} />}
    </>
  );
}

const STATUS_VERB: Partial<Record<OrderStatus, string>> = {
  confirmado: "Confirmar",
  en_preparacion: "Pasar a preparación",
  en_reparto: "Salir a reparto",
  entregado: "Marcar entregado",
  cancelado: "Cancelar pedido",
};

/** Cambios de estado permitidos para quien mira el pedido + asignación de repartidor. */
export function OrderActions({
  orderId,
  next,
  drivers,
  driverId,
}: {
  orderId: string;
  next: OrderStatus[];
  /** null = no puede asignar repartidor. */
  drivers: { id: string; name: string }[] | null;
  driverId?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const setStatus = (status: OrderStatus, why?: string) => run(status, () => api("POST", `/api/orders/${orderId}/status`, { status, reason: why }));

  return (
    <div className="space-y-3">
      {error && <Alert>{error}</Alert>}
      {next.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {next
            .filter((s) => s !== "cancelado")
            .map((s) => (
              <Button key={s} onClick={() => setStatus(s)} loading={busy === s} disabled={!!busy}>
                {STATUS_VERB[s] ?? ORDER_STATUS_LABELS[s]}
              </Button>
            ))}
          {next.includes("cancelado") && (
            <Button variant="ghost" onClick={() => setCancelling(true)} disabled={!!busy}>
              Cancelar pedido
            </Button>
          )}
        </div>
      )}
      {drivers && (
        <label className="block max-w-xs">
          <span className="mb-1 block text-xs text-ink-muted">Repartidor</span>
          <select
            value={driverId ?? ""}
            disabled={busy === "driver"}
            onChange={(e) => run("driver", () => api("POST", `/api/orders/${orderId}/driver`, { driverId: e.target.value || null }))}
            className={inputClass}
          >
            <option value="">Sin repartidor</option>
            {drivers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <Modal
        open={cancelling}
        onClose={() => setCancelling(false)}
        title="Cancelar pedido"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCancelling(false)}>
              Volver
            </Button>
            <Button
              variant="danger"
              disabled={!reason.trim()}
              loading={busy === "cancelado"}
              onClick={async () => {
                setCancelling(false);
                await setStatus("cancelado", reason.trim());
              }}
            >
              Cancelar pedido
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-ink-muted">Si ya estaba confirmado, se descuenta de las compras del cliente. El pedido y su historial se conservan.</p>
        <Field label="Motivo *">{(p) => <input {...p} value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} placeholder="El cliente lo anuló, sin stock…" />}</Field>
      </Modal>
    </div>
  );
}
