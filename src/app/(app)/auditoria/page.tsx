import type { Metadata } from "next";
import Link from "next/link";
import { Download, ShieldCheck } from "lucide-react";
import { requireAccess } from "@/server/auth/guards";
import { ApiError } from "@/server/api/handler";
import { listAuditLogs } from "@/server/audit-query";
import { getMembers } from "@/server/org/data";
import { auditQuery } from "@/lib/schemas";
import { AUDIT_CATEGORIES, AUDIT_CATEGORY_IDS, auditChanges, auditLabel } from "@/lib/audit-labels";
import type { AuditLog } from "@/types/model";
import { PageBody, PageHeader } from "@/components/ui/page";
import { inputClass } from "@/components/ui/styles";

export const metadata: Metadata = { title: "Auditoría" };

export default async function AuditPage({ searchParams }: PageProps<"/auditoria">) {
  const session = await requireAccess("auditoria");
  const raw = await searchParams;
  const parsed = auditQuery.safeParse(Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === "string" && v)));
  const filters = parsed.success ? parsed.data : {};
  const members = await getMembers(session.orgId);
  const names = new Map(members.map((m) => [m.id, m.displayName]));

  let page: { items: AuditLog[]; nextCursor: string | null } = { items: [], nextCursor: null };
  let error: string | null = parsed.success ? null : "Los filtros no son válidos.";
  try {
    if (parsed.success) page = await listAuditLogs(session, filters);
  } catch (e) {
    if (e instanceof ApiError) error = e.message;
    else if ((e as { code?: number }).code === 9) error = "Esta combinación de filtros todavía no tiene índice en la base.";
    else throw e;
  }

  const when = new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "medium", timeZone: session.org.timezone });
  const params = new URLSearchParams(Object.entries(filters).filter(([k, v]) => k !== "cursor" && typeof v === "string") as [string, string][]);
  const actor = (id: string) => (id === "system" ? "Sistema (automático)" : (names.get(id) ?? "Usuario eliminado"));

  return (
    <PageBody>
      <PageHeader
        title="Auditoría"
        description="Inicios de sesión y cambios de usuarios, permisos y configuración, con el valor anterior y el nuevo. Solo se agrega: nada se edita ni se borra."
        actions={
          <a href={`/api/audit/export?${params}`} className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3.5 py-2 text-sm font-medium hover:bg-canvas">
            <Download className="size-4" aria-hidden /> Exportar CSV
          </a>
        }
      />

      <form method="get" className="flex flex-wrap items-end gap-2">
        <label className="min-w-40 flex-1 sm:flex-none">
          <span className="mb-1 block text-xs font-medium text-ink-muted">Usuario</span>
          <select name="usuario" defaultValue={filters.usuario ?? ""} className={`${inputClass} sm:w-52`}>
            <option value="">Todos</option>
            <option value="system">Sistema (automático)</option>
            {[...members]
              .sort((a, b) => a.displayName.localeCompare(b.displayName))
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName}
                </option>
              ))}
          </select>
        </label>
        <label className="min-w-40 flex-1 sm:flex-none">
          <span className="mb-1 block text-xs font-medium text-ink-muted">Qué</span>
          <select name="categoria" defaultValue={filters.categoria ?? ""} className={`${inputClass} sm:w-52`}>
            <option value="">Todo</option>
            {AUDIT_CATEGORY_IDS.map((c) => (
              <option key={c} value={c}>
                {AUDIT_CATEGORIES[c].label}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-36 flex-1 sm:flex-none">
          <span className="mb-1 block text-xs font-medium text-ink-muted">Desde</span>
          <input type="date" name="desde" defaultValue={filters.desde ?? ""} className={inputClass} />
        </label>
        <label className="min-w-36 flex-1 sm:flex-none">
          <span className="mb-1 block text-xs font-medium text-ink-muted">Hasta</span>
          <input type="date" name="hasta" defaultValue={filters.hasta ?? ""} className={inputClass} />
        </label>
        <button type="submit" className="rounded-lg btn-primario px-3.5 py-2 text-sm">
          Filtrar
        </button>
        {[...params.keys()].length > 0 && (
          <Link href="/auditoria" className="px-2 py-2 text-sm text-ink-muted hover:underline">
            Limpiar
          </Link>
        )}
      </form>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {!error && page.items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-surface px-6 py-10 text-center text-sm text-ink-muted">
          <ShieldCheck className="mx-auto mb-2 size-7" aria-hidden />
          No hay registros con esos filtros.
        </div>
      ) : (
        <ul className="divide-y divide-line glass-card rounded-xl">
          {page.items.map((a) => {
            const changes = auditChanges(a.before, a.after);
            return (
              <li key={a.id} className="px-4 py-3">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                  <span className="font-medium">{auditLabel(a.action)}</span>
                  <span className="text-ink-muted">{actor(a.actorId)}</span>
                  <span className="ml-auto text-xs whitespace-nowrap text-ink-muted tabular-nums">{when.format(a.at)}</span>
                </div>
                <p className="mt-0.5 text-xs text-ink-muted">
                  <code>{a.action}</code> · {a.target.collection}/{a.target.id}
                  {a.ip ? ` · IP ${a.ip}` : ""}
                </p>
                {changes.length > 0 && (
                  <details className="mt-2 text-sm">
                    <summary className="cursor-pointer text-xs font-medium text-brand-700 hover:underline">
                      {changes.length} {changes.length === 1 ? "cambio" : "cambios"}
                    </summary>
                    <div className="mt-2 overflow-x-auto rounded-lg border border-line">
                      <table className="w-full min-w-[32rem] text-left text-xs">
                        <thead className="bg-canvas text-ink-muted">
                          <tr>
                            <th className="px-3 py-1.5 font-medium">Campo</th>
                            <th className="px-3 py-1.5 font-medium">Antes</th>
                            <th className="px-3 py-1.5 font-medium">Después</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                          {changes.map((c) => (
                            <tr key={c.field}>
                              <td className="px-3 py-1.5 font-mono">{c.field}</td>
                              <td className="px-3 py-1.5 break-all text-red-800">{c.before}</td>
                              <td className="px-3 py-1.5 break-all text-green-800">{c.after}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {page.nextCursor && (
        <div className="flex justify-center">
          <Link href={`/auditoria?${new URLSearchParams([...params, ["cursor", page.nextCursor]])}`} className="rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium hover:bg-canvas">
            Ver más antiguos
          </Link>
        </div>
      )}
    </PageBody>
  );
}
