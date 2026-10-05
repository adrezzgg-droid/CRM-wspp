import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Search, Users } from "lucide-react";
import { requireAccess } from "@/server/auth/guards";
import { can } from "@/server/permissions/matrix";
import { listCustomers, type CustomerPage } from "@/server/customers/service";
import { customerFormOptions } from "@/server/customers/options";
import { getMembersMap, OWNER_ROLES, scopeContext } from "@/server/org/data";
import { customerListQuery, CUSTOMER_STAGES } from "@/lib/schemas";
import { formatWhatsappId } from "@/lib/phone";
import { CUSTOMER_STAGE_LABELS } from "@/types/model";
import { PageBody, PageHeader } from "@/components/ui/page";
import { StageBadge, TagChip, Badge } from "@/components/ui/badges";
import { inputClass } from "@/components/ui/styles";
import { NewCustomerButton } from "./customer-form";

export const metadata: Metadata = { title: "Clientes" };

const dateFmt = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" });

export default async function CustomersPage({ searchParams }: PageProps<"/clientes">) {
  const session = await requireAccess("clientes");
  const raw = await searchParams;
  const parsed = customerListQuery.safeParse(
    Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === "string" && v !== "")),
  );
  const filters = parsed.success ? parsed.data : {};

  const [options, members, ctx] = await Promise.all([
    customerFormOptions(session),
    getMembersMap(session.orgId),
    scopeContext(session, "clientes"),
  ]);

  let page: CustomerPage = { items: [], nextCursor: null };
  let loadError: string | null = null;
  try {
    page = await listCustomers(session, filters);
  } catch (error) {
    // FAILED_PRECONDITION = falta un índice compuesto para esta combinación de filtros.
    console.error("[clientes] listado", error);
    loadError =
      (error as { code?: number }).code === 9
        ? "Esta combinación de filtros todavía no tiene índice en la base. Probá con menos filtros y avisale al administrador."
        : "No se pudo cargar el listado.";
  }

  const tagsById = new Map(options.tags.map((t) => [t.id, t]));
  const zonesById = new Map(options.zones.map((z) => [z.id, z.name]));
  const canCreate = can(session.role, "clientes", "crear", session.overrides);
  const canArchive = can(session.role, "clientes", "eliminar", session.overrides);
  const showOwnerFilter = ctx.scope !== "propio";
  const hasFilters = Object.keys(filters).some((k) => k !== "cursor");

  const params = new URLSearchParams(
    Object.entries(filters).filter(([k, v]) => k !== "cursor" && typeof v === "string") as [string, string][],
  );
  const nextHref = page.nextCursor ? `/clientes?${new URLSearchParams([...params, ["cursor", page.nextCursor]])}` : null;

  return (
    <PageBody>
      <PageHeader
        title={filters.archivados ? "Clientes dados de baja" : "Clientes"}
        description={
          ctx.scope === "propio" ? "Tus clientes y prospectos." : ctx.scope === "equipo" ? "Clientes de tu equipo." : "Todos los clientes y prospectos."
        }
        actions={canCreate && !filters.archivados ? <NewCustomerButton options={options} defaultOwner={options.owners.some((o) => o.id === session.uid) ? session.uid : ""} /> : undefined}
      />

      <form method="get" className="grid gap-2 rounded-xl border border-line bg-surface p-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="relative sm:col-span-2">
          <span className="sr-only">Buscar</span>
          <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-ink-muted" aria-hidden />
          <input name="q" defaultValue={filters.q} placeholder="Nombre, teléfono, empresa, dirección…" className={`${inputClass} pl-9`} />
        </label>
        <select name="stage" defaultValue={filters.stage ?? ""} className={inputClass} aria-label="Etapa">
          <option value="">Todas las etapas</option>
          {CUSTOMER_STAGES.map((s) => (
            <option key={s} value={s}>
              {CUSTOMER_STAGE_LABELS[s]}
            </option>
          ))}
        </select>
        {showOwnerFilter ? (
          <select name="owner" defaultValue={filters.owner ?? ""} className={inputClass} aria-label="Responsable">
            <option value="">Todos los responsables</option>
            <option value="none">Sin asignar</option>
            {[...members.values()]
              .filter((m) => OWNER_ROLES.has(m.role) && (ctx.scope === "todo" || ctx.teamUids.includes(m.id)))
              .sort((a, b) => a.displayName.localeCompare(b.displayName, "es"))
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName}
                  {m.active ? "" : " (baja)"}
                </option>
              ))}
          </select>
        ) : null}
        <select name="zone" defaultValue={filters.zone ?? ""} className={inputClass} aria-label="Zona">
          <option value="">Todas las zonas</option>
          {options.zones.map((z) => (
            <option key={z.id} value={z.id}>
              {z.name}
            </option>
          ))}
        </select>
        <select name="tag" defaultValue={filters.tag ?? ""} className={inputClass} aria-label="Etiqueta">
          <option value="">Todas las etiquetas</option>
          {options.tags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-2">
          <button type="submit" className="flex-1 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
            Filtrar
          </button>
          {hasFilters && (
            <Link href="/clientes" className="rounded-lg px-3 py-2 text-sm text-ink-muted hover:bg-canvas">
              Limpiar
            </Link>
          )}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm sm:col-span-2 lg:col-span-4">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="reactivar" value="1" defaultChecked={!!filters.reactivar} className="size-4 accent-brand-600" />
            Para reactivar
          </label>
          {canArchive && (
            <label className="flex items-center gap-2">
              <input type="checkbox" name="archivados" value="1" defaultChecked={!!filters.archivados} className="size-4 accent-brand-600" />
              Ver dados de baja
            </label>
          )}
        </div>
      </form>

      {loadError ? (
        <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {loadError}
        </p>
      ) : page.items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-surface px-6 py-12 text-center">
          <Users className="mx-auto size-8 text-ink-muted" aria-hidden />
          <p className="mt-3 font-medium">{hasFilters ? "No hay clientes con esos filtros." : "Todavía no hay clientes."}</p>
          {!hasFilters && canCreate && <p className="mt-1 text-sm text-ink-muted">Creá el primero con “Nuevo cliente”.</p>}
        </div>
      ) : (
        <>
          {/* Tabla en tablet/escritorio */}
          <div className="hidden overflow-hidden rounded-xl border border-line bg-surface md:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-canvas text-xs text-ink-muted uppercase">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Cliente</th>
                  <th className="px-4 py-2.5 font-medium">WhatsApp</th>
                  <th className="hidden px-4 py-2.5 font-medium xl:table-cell">Zona / localidad</th>
                  <th className="px-4 py-2.5 font-medium">Responsable</th>
                  <th className="px-4 py-2.5 font-medium">Etapa</th>
                  <th className="hidden px-4 py-2.5 font-medium lg:table-cell">Etiquetas</th>
                  <th className="px-4 py-2.5 text-right font-medium">Actualizado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {page.items.map((c) => (
                  <tr key={c.id} className="group relative hover:bg-canvas">
                    <td className="px-4 py-3">
                      <Link href={`/clientes/${c.id}`} className="font-medium after:absolute after:inset-0 group-hover:text-brand-700">
                        {c.name}
                      </Link>
                      {c.company && <p className="text-xs text-ink-muted">{c.company}</p>}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-ink-muted">{c.whatsappId ? formatWhatsappId(c.whatsappId) : c.phone ?? "—"}</td>
                    <td className="hidden px-4 py-3 text-ink-muted xl:table-cell">
                      {[c.zoneId && zonesById.get(c.zoneId), c.locality].filter(Boolean).join(" · ") || "—"}
                    </td>
                    <td className="px-4 py-3">{c.ownerId ? members.get(c.ownerId)?.displayName ?? "—" : <Badge tone="warn">Sin asignar</Badge>}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1">
                        <StageBadge stage={c.stage} />
                        {c.needsReactivation && <Badge tone="danger">Reactivar</Badge>}
                      </div>
                    </td>
                    <td className="hidden px-4 py-3 lg:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {c.tagIds.slice(0, 3).map((id) => {
                          const t = tagsById.get(id);
                          return t ? <TagChip key={id} name={t.name} color={t.color} /> : null;
                        })}
                        {c.tagIds.length > 3 && <span className="text-xs text-ink-muted">+{c.tagIds.length - 3}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap text-ink-muted">{dateFmt.format(c.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Tarjetas en móvil */}
          <ul className="space-y-2 md:hidden">
            {page.items.map((c) => (
              <li key={c.id}>
                <Link href={`/clientes/${c.id}`} className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3 active:bg-canvas">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{c.name}</p>
                    <p className="truncate text-xs text-ink-muted">
                      {[c.company, c.whatsappId ? formatWhatsappId(c.whatsappId) : c.phone].filter(Boolean).join(" · ") || "Sin datos de contacto"}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      <StageBadge stage={c.stage} />
                      {!c.ownerId && <Badge tone="warn">Sin asignar</Badge>}
                      {c.needsReactivation && <Badge tone="danger">Reactivar</Badge>}
                    </div>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-ink-muted" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>

          <nav className="flex items-center justify-between text-sm" aria-label="Paginación">
            <span className="text-ink-muted">{page.items.length} en esta página</span>
            <div className="flex gap-2">
              {filters.cursor && (
                <Link href={`/clientes?${params}`} className="rounded-lg border border-line bg-surface px-3 py-1.5 hover:bg-canvas">
                  Primera página
                </Link>
              )}
              {nextHref && (
                <Link href={nextHref} className="rounded-lg border border-line bg-surface px-3 py-1.5 hover:bg-canvas">
                  Siguiente
                </Link>
              )}
            </div>
          </nav>
        </>
      )}
    </PageBody>
  );
}
