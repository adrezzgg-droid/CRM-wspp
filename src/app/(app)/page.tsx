import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, House, LayoutGrid, Settings, ShoppingCart, type LucideIcon } from "lucide-react";
import { requireSession } from "@/server/auth/guards";
import { can } from "@/server/permissions/matrix";
import type { Session } from "@/server/auth/session";
import { adminDb } from "@/server/firebase/admin";
import { listTasks } from "@/server/tasks/service";
import { OPEN_STATUSES } from "@/lib/inbox-filters";
import { navGroupsFor, type NavGroupId } from "@/lib/navigation";
import { orgPath } from "@/types/model";
import { NAV_ICONS } from "@/components/shell/nav-icons";

export const metadata: Metadata = { title: "Inicio" };

const GROUP_ICONS: Record<NavGroupId, LucideIcon> = { principal: House, ventas: ShoppingCart, sistema: Settings };

/** Pendientes personales que se muestran en las tarjetas (como los avisos de Impulse360). */
async function pendientes(session: Session): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const sees = (r: Parameters<typeof can>[1]) => can(session.role, r, "ver", session.overrides);
  await Promise.all([
    sees("inbox") && session.role !== "repartidor"
      ? adminDb()
          .collection(orgPath(session.orgId, "conversations"))
          .where("assigneeId", "==", session.uid)
          .where("awaitingReply", "==", true)
          .where("status", "in", OPEN_STATUSES)
          .count()
          .get()
          .then((r) => (out["/inbox"] = r.data().count))
          .catch(() => undefined)
      : null,
    sees("tareas") ? listTasks(session, { vista: "vencidas", responsable: session.uid }).then((t) => (out["/tareas"] = t.length)).catch(() => undefined) : null,
  ]);
  out["/mi-dia"] = (out["/inbox"] ?? 0) + (out["/tareas"] ?? 0);
  return out;
}

function Pendiente({ n }: { n: number }) {
  if (!n) return null;
  return <span className="inline-flex items-center rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold tracking-wide text-amber-700 uppercase">{n} pendiente{n === 1 ? "" : "s"}</span>;
}

/**
 * Panel de inicio, igual que Impulse360: primero las categorías; al entrar a
 * una, sus secciones. Con una sola categoría se muestran directo las secciones.
 */
export default async function PanelPage({ searchParams }: PageProps<"/">) {
  const session = await requireSession();
  const groups = navGroupsFor(session.role, session.overrides);
  const pedido = (await searchParams).categoria;
  const elegida = groups.find((g) => g.id === pedido) ?? (groups.length === 1 ? groups[0] : null);
  const avisos = await pendientes(session);
  const primerNombre = session.member.displayName.trim().split(/\s+/)[0];

  if (!elegida) {
    return (
      <div className="fade-in mx-auto w-full max-w-5xl p-4 sm:p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Hola{primerNombre ? `, ${primerNombre}` : ""}</h1>
          <p className="text-sm text-ink-muted">Elegí a qué categoría querés entrar.</p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((g) => {
            const Icon = GROUP_ICONS[g.id] ?? LayoutGrid;
            const n = g.items.filter((i) => i.href !== "/mi-dia").reduce((s, i) => s + (avisos[i.href] ?? 0), 0);
            return (
              <Link key={g.id} href={`/?categoria=${g.id}`} className="glass-card flex min-h-[120px] items-start gap-4 rounded-2xl p-5 text-left">
                <span className="grid size-14 shrink-0 place-items-center rounded-2xl text-brand-600">
                  <Icon className="size-[26px]" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-lg font-bold">{g.label}</span>
                    <Pendiente n={n} />
                  </span>
                  <span className="mt-1 block text-xs text-ink-muted">{g.description}</span>
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="fade-in mx-auto w-full max-w-5xl p-4 sm:p-6">
      <div className="mb-6">
        {groups.length > 1 && (
          <Link href="/" className="mb-3 flex w-fit items-center gap-1.5 text-sm font-semibold text-ink-muted hover:text-ink">
            <ArrowLeft className="size-[15px]" aria-hidden /> Categorías
          </Link>
        )}
        <h1 className="text-2xl font-bold">{elegida.label}</h1>
        <p className="text-sm text-ink-muted">Elegí a qué sección querés entrar.</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {elegida.items.map((item) => {
          const Icon = NAV_ICONS[item.icon];
          return (
            <Link key={item.href} href={item.href} className="glass-card flex min-h-[92px] items-start gap-3 rounded-xl p-4 text-left">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl text-brand-600">
                <Icon className="size-[22px]" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-bold">{item.label}</span>
                  <Pendiente n={avisos[item.href] ?? 0} />
                </span>
                <span className="mt-0.5 block text-xs text-ink-muted">{item.description}</span>
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
