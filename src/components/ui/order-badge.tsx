import type { OrderStatus } from "@/types/model";
import { ORDER_STATUS_LABELS } from "@/types/model";

const STYLES: Record<OrderStatus, string> = {
  borrador: "bg-slate-100 text-slate-700 ring-slate-200",
  confirmado: "bg-sky-50 text-sky-700 ring-sky-200",
  en_preparacion: "bg-violet-50 text-violet-700 ring-violet-200",
  en_reparto: "bg-amber-50 text-amber-800 ring-amber-200",
  entregado: "bg-green-50 text-green-700 ring-green-200",
  cancelado: "bg-red-50 text-red-700 ring-red-200",
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ${STYLES[status]}`}>
      {ORDER_STATUS_LABELS[status]}
    </span>
  );
}
