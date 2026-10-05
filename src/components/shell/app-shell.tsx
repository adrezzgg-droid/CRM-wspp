"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Boxes,
  ChartColumn,
  FlaskConical,
  Inbox,
  Menu,
  MessageCircle,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  ShieldCheck,
  SquareCheckBig,
  SquareKanban,
  Sun,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { SIDEBAR_COOKIE, type NavIcon, type NavItem } from "@/lib/navigation";
import { NotificationBell } from "./notification-bell";
import { UserMenu } from "./user-menu";

const ICONS: Record<NavIcon, LucideIcon> = {
  sun: Sun,
  chart: ChartColumn,
  inbox: Inbox,
  users: Users,
  kanban: SquareKanban,
  package: Package,
  boxes: Boxes,
  check: SquareCheckBig,
  shield: ShieldCheck,
  settings: Settings,
};

export interface ShellUser {
  displayName: string;
  email: string;
  roleLabel: string;
}

export interface ShellOrg {
  name: string;
  isDemo: boolean;
}

const appName = process.env.NEXT_PUBLIC_APP_NAME ?? "CRM WhatsApp";

/**
 * Estructura de la app:
 *  - escritorio (lg+): sidebar completa, se puede colapsar a íconos
 *  - tablet (md):      sidebar de íconos
 *  - móvil:            sidebar como cajón con botón de menú
 */


export function AppShell({
  nav,
  user,
  org,
  initialCollapsed,
  children,
}: {
  nav: NavItem[];
  user: ShellUser;
  org: ShellOrg;
  /** Preferencia guardada en cookie: el servidor la lee y no hay parpadeo al cargar. */
  initialCollapsed: boolean;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `${SIDEBAR_COOKIE}=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
  }

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const navList = (compact: boolean, onNavigate?: () => void) => (
    <ul className="space-y-1">
      {nav.map((item) => {
        const Icon = ICONS[item.icon];
        const active = isActive(item.href);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              title={compact ? item.label : undefined}
              aria-current={active ? "page" : undefined}
              onClick={onNavigate}
              className={[
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition",
                compact ? "justify-center" : "",
                active
                  ? "bg-brand-700 text-white"
                  : "text-brand-100 hover:bg-brand-800 hover:text-white",
              ].join(" ")}
            >
              <Icon className="size-5 shrink-0" aria-hidden />
              <span className={compact ? "sr-only" : ""}>{item.label}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );

  const brand = (compact: boolean) => (
    <div className={`flex h-14 items-center gap-2 px-4 ${compact ? "justify-center px-0" : ""}`}>
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-500 text-white">
        <MessageCircle className="size-4" aria-hidden />
      </span>
      {!compact && <span className="truncate font-semibold text-white">{appName}</span>}
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      {org.isDemo && (
        <div
          role="status"
          className="flex items-center justify-center gap-2 bg-amber-400 px-4 py-1.5 text-center text-xs font-semibold text-amber-950 sm:text-sm"
        >
          <FlaskConical className="size-4 shrink-0" aria-hidden />
          MODO DEMO · Datos de prueba de “{org.name}”. No se envían mensajes reales por WhatsApp.
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* Sidebar tablet/escritorio */}
        <aside
          className={`hidden shrink-0 flex-col bg-brand-950 md:flex ${collapsed ? "w-16" : "w-16 lg:w-60"}`}
        >
          <div className="lg:hidden">{brand(true)}</div>
          <div className="hidden lg:block">{brand(collapsed)}</div>
          <nav aria-label="Principal" className="flex-1 overflow-y-auto px-2 py-3">
            <div className="lg:hidden">{navList(true)}</div>
            <div className="hidden lg:block">{navList(collapsed)}</div>
          </nav>
          <button
            type="button"
            onClick={toggleCollapsed}
            className="m-2 hidden items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs text-brand-200 hover:bg-brand-800 hover:text-white lg:flex"
            aria-label={collapsed ? "Expandir menú" : "Colapsar menú"}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-4" aria-hidden />
            ) : (
              <>
                <PanelLeftClose className="size-4" aria-hidden /> Colapsar
              </>
            )}
          </button>
        </aside>

        {/* Cajón móvil */}
        {drawerOpen && (
          <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Menú">
            <button
              type="button"
              className="absolute inset-0 bg-black/40"
              aria-label="Cerrar menú"
              onClick={() => setDrawerOpen(false)}
            />
            <aside className="relative flex h-full w-72 max-w-[85%] flex-col bg-brand-950">
              <div className="flex items-center justify-between pr-2">
                {brand(false)}
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  className="rounded-lg p-2 text-brand-100 hover:bg-brand-800"
                  aria-label="Cerrar menú"
                >
                  <X className="size-5" aria-hidden />
                </button>
              </div>
              <nav aria-label="Principal" className="flex-1 overflow-y-auto px-2 py-3">
                {navList(false, () => setDrawerOpen(false))}
              </nav>
            </aside>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface px-3 sm:px-4">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="rounded-lg p-2 text-ink-muted hover:bg-canvas md:hidden"
              aria-label="Abrir menú"
            >
              <Menu className="size-5" aria-hidden />
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{org.name}</p>
            </div>
            <NotificationBell />
            <UserMenu user={user} />
          </header>
          <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
        </div>
      </div>
    </div>
  );
}
