import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Package } from "lucide-react";
import { requireAccess } from "@/server/auth/guards";
import { can } from "@/server/permissions/matrix";
import { scopeAllows } from "@/server/permissions/scope";
import { getMembers, OWNER_ROLES, scopeContext } from "@/server/org/data";
import { listOrders } from "@/server/commercial/orders";
import { listProducts } from "@/server/commercial/products";
import { orderListQuery, ORDER_STATUSES } from "@/lib/schemas";
import { ORDER_STATUS_LABELS, type Order } from "@/types/model";
import { PageBody, PageHeader } from "@/components/ui/page";
import { inputClass } from "@/components/ui/styles";
import { OrderStatusBadge } from "@/components/ui/order-badge";
import { NewOrderButton } from "./order-actions";

export const metadata: Metadata = { title: "Pedidos" };

export default async function OrdersPage({ searchParams }: PageProps<"/pedidos">) {
  const session = await requireAccess("pedidos");
  const raw = await searchParams;
  const parsed = orderListQuery.safeParse(Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === "string" && v)));
  const filters = parsed.success ? parsed.data : {};
  const isDriver = session.role === "repartidor";

  const [members, ctx] = await Promise.all([getMembers(session.orgId), scopeContext(session, "pedidos")]);
  let page: { items: Order[]; nextCursor: string | null } = { items: [], nextCursor: null };
  let loadError: string | null = null;
  try {
    page = await listOrders(session, filters);
  } catch (error) {
    console.error("[pedidos] listado", error);
    loadError = (error as { code?: number }).code === 9 ? "Esta combinación de filtros todavía no tiene índice en la base." : "No se pudo cargar el listado.";
  }

  const canCreate = !isDriver && can(session.role, "pedidos", "crear", session.overrides);
  const products = canCreate ? (await listProducts(session)).map((p) => ({ id: p.id, name: p.name, sku: p.sku, unit: p.unit, price: p.price })) : [];
  const names = new Map(members.map((m) => [m.id, m.displayName]));
  const sellers = ctx.scope === "propio" || isDriver ? [] : members.filter((m) => OWNER_ROLES.has(m.role) && scopeAllows(ctx, m.id));
  const drivers = isDriver ? [] : members.filter((m) => m.role === "repartidor");
  const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: session.org.currency });
  const date = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: session.org.timezone });
  const day = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", timeZone: session.org.timezone });
  const params = new URLSearchParams(Object.entries(filters).filter(([k, v]) => k !== "cursor" && typeof v === "string") as [string, string][]);
  const hasFilters = [...params.keys()].length > 0;

  return (
    <PageBody>
      <PageHeader
        title={isDriver ? "Mis entregas" : "Pedidos"}
        description={isDriver ? "Pedidos asignados a vos para entregar." : ctx.scope === "propio" ? "Tus pedidos." : ctx.scope === "equipo" ? "Pedidos de tu equipo." : "Todos los pedidos."}
        actions={canCreate ? <NewOrderButton products={products} currency={session.org.currency} /> : undefined}
      />

      <form method="get" className="flex flex-wrap gap-2">
        <select name="status" defaultValue={filters.status ?? ""} className={`${inputClass} max-w-48`} aria-label="Estado">
          <option value="">Todos los estados</option>
          {ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {ORDER_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        {sellers.length > 0 && (
          <select name="vendedor" defaultValue={filters.vendedor ?? ""} className={`${inputClass} max-w-52`} aria-label="Vendedor">
            <option value="">Todos los vendedores</option>
            {sellers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))}
          </select>
        )}
        {drivers.length > 0 && (
          <select name="repartidor" defaultValue={filters.repartidor ?? ""} className={`${inputClass} max-w-52`} aria-label="Repartidor">
            <option value="">Todos los repartidores</option>
            {drivers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))}
          </select>
        )}
        <button type="submit" className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
          Filtrar
        </button>
        {hasFilters && (
          <Link href="/pedidos" className="rounded-lg px-3 py-2 text-sm text-ink-muted hover:bg-surface">
            Limpiar
          </Link>
        )}
      </form>

      {loadError ? (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {loadError}
        </p>
      ) : page.items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-surface px-6 py-12 text-center">
          <Package className="mx-auto size-8 text-ink-muted" aria-hidden />
          <p className="mt-3 font-medium">{hasFilters ? "No hay pedidos con esos filtros." : isDriver ? "No tenés entregas asignadas." : "Todavía no hay pedidos."}</p>
        </div>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
          {page.items.map((o) => (
            <li key={o.id}>
              <Link href={`/pedidos/${o.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-canvas">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-mono font-medium">{o.number}</span>
                    <span className="truncate font-medium">{o.customerName}</span>
                    <OrderStatusBadge status={o.status} />
                  </p>
                  <p className="truncate text-xs text-ink-muted">
                    {date.format(o.createdAt)} · {o.items.length} {o.items.length === 1 ? "producto" : "productos"} · vende {names.get(o.sellerId) ?? "—"}
                    {o.driverId ? ` · reparte ${names.get(o.driverId) ?? "—"}` : ""}
                    {o.deliveryDate ? ` · entrega ${day.format(o.deliveryDate)}` : ""}
                    {isDriver && o.deliveryAddress ? ` · ${o.deliveryAddress}` : ""}
                  </p>
                </div>
                <span className="text-sm font-semibold whitespace-nowrap">{money.format(o.total)}</span>
                <ChevronRight className="size-4 shrink-0 text-ink-muted" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {(filters.cursor || page.nextCursor) && (
        <nav className="flex justify-end gap-2 text-sm" aria-label="Paginación">
          {filters.cursor && (
            <Link href={`/pedidos?${params}`} className="rounded-lg border border-line bg-surface px-3 py-1.5 hover:bg-canvas">
              Primera página
            </Link>
          )}
          {page.nextCursor && (
            <Link href={`/pedidos?${new URLSearchParams([...params, ["cursor", page.nextCursor]])}`} className="rounded-lg border border-line bg-surface px-3 py-1.5 hover:bg-canvas">
              Siguiente
            </Link>
          )}
        </nav>
      )}
    </PageBody>
  );
}

