import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import type { Activity, OrderStatus } from "@/types/model";
import { ORDER_STATUS_LABELS, orgPath } from "@/types/model";
import { requireAccess } from "@/server/auth/guards";
import { ApiError } from "@/server/api/handler";
import { adminDb } from "@/server/firebase/admin";
import { can } from "@/server/permissions/matrix";
import { getMembers } from "@/server/org/data";
import { loadOrder, orderActor } from "@/server/commercial/orders";
import { nextStatuses } from "@/lib/orders";
import { PageBody } from "@/components/ui/page";
import { OrderStatusBadge } from "@/components/ui/order-badge";
import { ActivityTimeline } from "@/components/activity/timeline";
import { OrderActions } from "../order-actions";

export const metadata: Metadata = { title: "Pedido" };

const FLOW: OrderStatus[] = ["borrador", "confirmado", "en_preparacion", "en_reparto", "entregado"];

export default async function OrderPage({ params }: PageProps<"/pedidos/[id]">) {
  const session = await requireAccess("pedidos");
  const { id } = await params;
  let order;
  try {
    order = await loadOrder(session, id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }
  const [members, activitySnap] = await Promise.all([
    getMembers(session.orgId),
    adminDb().collection(orgPath(session.orgId, "activities")).where("orderId", "==", id).orderBy("at", "desc").limit(50).get(),
  ]);
  const activities = activitySnap.docs.map((d) => ({ ...(d.data() as Activity), id: d.id }));
  const names = new Map(members.map((m) => [m.id, m.displayName]));
  const tz = session.org.timezone;
  const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: order.currency });
  const dateTime = new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short", timeZone: tz });
  const day = new Intl.DateTimeFormat("es-AR", { dateStyle: "full", timeZone: tz });

  const actor = orderActor(session);
  const canEdit = can(session.role, "pedidos", "editar", session.overrides) && (actor !== "repartidor" || order.driverId === session.uid);
  const next = canEdit ? nextStatuses(actor, order.status) : [];
  const canAssignDriver = can(session.role, "pedidos", "asignar", session.overrides) && order.status !== "entregado" && order.status !== "cancelado";
  const drivers = canAssignDriver ? members.filter((m) => m.active && m.role === "repartidor").map((m) => ({ id: m.id, name: m.displayName })) : null;
  const seeCustomer = can(session.role, "clientes", "ver", session.overrides);

  return (
    <PageBody>
      <Link href="/pedidos" className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Pedidos
      </Link>

      <header className="space-y-4 rounded-xl border border-line bg-surface p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-sm text-ink-muted">{order.number}</p>
            <h1 className="text-xl font-semibold">
              {seeCustomer ? (
                <Link href={`/clientes/${order.customerId}`} className="hover:text-brand-700">
                  {order.customerName}
                </Link>
              ) : (
                order.customerName
              )}
            </h1>
            <p className="mt-1 text-sm text-ink-muted">
              Vende {names.get(order.sellerId) ?? "—"} · {order.driverId ? `reparte ${names.get(order.driverId) ?? "—"}` : "sin repartidor"}
            </p>
          </div>
          <div className="text-right">
            <OrderStatusBadge status={order.status} />
            <p className="mt-2 text-2xl font-semibold">{money.format(order.total)}</p>
          </div>
        </div>

        {/* Recorrido del pedido */}
        {order.status !== "cancelado" ? (
          <ol className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {FLOW.map((s) => {
              const at = order.statusAt?.[s];
              return (
                <li key={s} className={at ? "font-medium text-brand-800" : "text-ink-muted"}>
                  {at ? "●" : "○"} {ORDER_STATUS_LABELS[s]}
                  {at && <span className="font-normal text-ink-muted"> {dateTime.format(at)}</span>}
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            Cancelado{order.statusAt?.cancelado ? ` el ${dateTime.format(order.statusAt.cancelado)}` : ""}: {order.cancelReason}
          </p>
        )}

        {(next.length > 0 || drivers) && <OrderActions orderId={order.id} next={next} drivers={drivers} driverId={order.driverId} />}
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="overflow-hidden rounded-xl border border-line bg-surface lg:col-span-2">
          <h2 className="border-b border-line px-4 py-3 text-sm font-semibold">Productos</h2>
          <table className="w-full text-sm">
            <thead className="bg-canvas text-xs text-ink-muted">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Producto</th>
                <th className="px-4 py-2 text-right font-medium">Cantidad</th>
                <th className="hidden px-4 py-2 text-right font-medium sm:table-cell">Precio</th>
                <th className="px-4 py-2 text-right font-medium">Subtotal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {order.items.map((i, idx) => (
                <tr key={idx}>
                  <td className="px-4 py-2">{i.name}</td>
                  <td className="px-4 py-2 text-right">{i.qty}</td>
                  <td className="hidden px-4 py-2 text-right sm:table-cell">{money.format(i.unitPrice)}</td>
                  <td className="px-4 py-2 text-right font-medium">{money.format(i.qty * i.unitPrice)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line">
                <td colSpan={2} className="px-4 py-3 font-semibold sm:hidden">
                  Total
                </td>
                <td colSpan={3} className="hidden px-4 py-3 text-right font-semibold sm:table-cell">
                  Total
                </td>
                <td className="px-4 py-3 text-right font-semibold">{money.format(order.total)}</td>
              </tr>
            </tfoot>
          </table>
        </section>

        <div className="space-y-6">
          <section className="rounded-xl border border-line bg-surface p-4 text-sm">
            <h2 className="mb-2 font-semibold">Entrega</h2>
            <dl className="space-y-1.5">
              <div>
                <dt className="text-xs text-ink-muted">Dirección</dt>
                <dd>{order.deliveryAddress ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-muted">Fecha</dt>
                <dd>{order.deliveryDate ? day.format(order.deliveryDate) : "A coordinar"}</dd>
              </div>
              {order.notes && (
                <div>
                  <dt className="text-xs text-ink-muted">Notas</dt>
                  <dd className="whitespace-pre-wrap">{order.notes}</dd>
                </div>
              )}
              {order.conversationId && actor !== "repartidor" && (
                <div>
                  <Link href={`/inbox?c=${order.conversationId}`} className="text-xs font-medium text-brand-700 hover:underline">
                    Ver la conversación de WhatsApp
                  </Link>
                </div>
              )}
            </dl>
          </section>

          <section className="rounded-xl border border-line bg-surface p-4">
            <h2 className="mb-3 text-sm font-semibold">Historial</h2>
            <ActivityTimeline items={activities} lookups={{ members: names, tags: new Map(), zones: new Map() }} timezone={tz} />
          </section>
        </div>
      </div>
    </PageBody>
  );
}
