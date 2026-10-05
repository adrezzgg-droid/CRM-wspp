import type { Metadata } from "next";
import Link from "next/link";
import { requireAccess } from "@/server/auth/guards";
import { can } from "@/server/permissions/matrix";
import { listProducts } from "@/server/commercial/products";
import { productListQuery } from "@/lib/schemas";
import { PageBody, PageHeader } from "@/components/ui/page";
import { inputClass } from "@/components/ui/styles";
import { ProductsManager } from "./products-manager";

export const metadata: Metadata = { title: "Productos" };

export default async function ProductsPage({ searchParams }: PageProps<"/productos">) {
  const session = await requireAccess("productos");
  const raw = await searchParams;
  const parsed = productListQuery.safeParse(Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === "string" && v)));
  const filters = parsed.success ? parsed.data : {};
  const products = await listProducts(session, filters);
  const canCreate = can(session.role, "productos", "crear", session.overrides);

  return (
    <PageBody>
      <PageHeader title="Productos" description={`${products.length} productos${filters.inactivos ? "" : " activos"} con precio de lista.`} />
      <form method="get" className="flex flex-wrap items-center gap-2">
        <input name="q" defaultValue={filters.q} placeholder="Buscar por nombre o código" className={`${inputClass} max-w-xs`} aria-label="Buscar" />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="inactivos" value="1" defaultChecked={!!filters.inactivos} className="size-4 accent-brand-600" />
          Incluir inactivos
        </label>
        <button type="submit" className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
          Filtrar
        </button>
        {(filters.q || filters.inactivos) && (
          <Link href="/productos" className="rounded-lg px-3 py-2 text-sm text-ink-muted hover:bg-surface">
            Limpiar
          </Link>
        )}
      </form>
      <ProductsManager products={products} currency={session.org.currency} canCreate={canCreate} canEdit={can(session.role, "productos", "editar", session.overrides)} />
    </PageBody>
  );
}
