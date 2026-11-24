"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, ChevronRight, FlaskConical, LayoutGrid } from "lucide-react";
import type { NavGroup, NavItem } from "@/lib/navigation";
import { NAV_ICONS } from "./nav-icons";
import { NotificationBell } from "./notification-bell";
import { UserMenu } from "./user-menu";


export interface ShellUser {
  displayName: string;
  email: string;
  roleLabel: string;
  /** Solo para roles que atienden clientes: disponibilidad para asignación automática. */
  available?: boolean;
}

export interface ShellOrg {
  name: string;
  isDemo: boolean;
}

/**
 * Estructura de la app, igual que Impulse360: una barra fija arriba (marca que
 * vuelve al panel, sección actual, "Volver al panel", atajo "Ir a…",
 * notificaciones y usuario) y debajo la pantalla. El inicio es el panel de
 * categorías (app/(app)/page.tsx); no hay menú lateral.
 */
export function AppShell({
  groups,
  user,
  org,
  children,
}: {
  groups: (NavGroup & { items: NavItem[] })[];
  user: ShellUser;
  org: ShellOrg;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  // El menú "Ir a…" queda abierto solo en la página donde se abrió: al navegar se cierra solo.
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === pathname;
  const setOpen = (v: boolean) => setOpenAt(v ? pathname : null);
  const menuRef = useRef<HTMLDivElement>(null);
  const items = groups.flatMap((g) => g.items);
  const current = items.find((i) => pathname === i.href || pathname.startsWith(`${i.href}/`));
  const atHome = pathname === "/";

  // También se cierra al tocar afuera o con Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setOpenAt(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenAt(null);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="flex h-full flex-col">
      {org.isDemo && (
        <div role="status" className="flex items-center justify-center gap-2 bg-amber-400 px-4 py-1.5 text-center text-xs font-bold text-amber-950 sm:text-sm">
          <FlaskConical className="size-4 shrink-0" aria-hidden />
          MODO DEMO · Datos de prueba de “{org.name}”. No se envían mensajes reales por WhatsApp.
        </div>
      )}

      <header className="glass-card-dark relative z-40 flex min-h-14 shrink-0 items-center gap-2 rounded-none border-x-0 border-t-0 !bg-[rgba(11,15,25,0.92)] px-3 py-2 text-[#F0EEE6] md:gap-3 md:px-6">
        <Link href="/" className="flex min-w-0 shrink-0 items-center gap-2" title="Ir al panel">
          <span className="grid size-8 shrink-0 place-items-center rounded bg-gradient-to-br from-brand-600 to-brand-700 text-sm font-black text-white">
            {org.name.charAt(0).toUpperCase()}
          </span>
          <span className="hidden truncate text-[15px] font-bold tracking-[0.03em] uppercase sm:block">{org.name}</span>
        </Link>

        {!atHome && current && (
          <>
            <ChevronRight className="size-3.5 shrink-0 text-[#8890AC]" aria-hidden />
            <span className="min-w-0 truncate text-sm font-semibold">{current.label}</span>
          </>
        )}

        <div className="flex-1" />

        {!atHome && (
          <Link
            href={current ? `/?categoria=${current.group}` : "/"}
            title="Volver al panel"
            aria-label="Volver al panel"
            className="grid shrink-0 place-items-center rounded-lg bg-white/10 p-2.5 hover:bg-white/20"
          >
            <ArrowLeft className="size-4" aria-hidden />
          </Link>
        )}

        {items.length > 1 && (
          <div className="shrink-0" ref={menuRef}>
            <button
              type="button"
              onClick={() => setOpen(!open)}
              aria-expanded={open}
              aria-haspopup="menu"
              title="Ir a…"
              aria-label="Ir a…"
              className="grid place-items-center rounded-lg bg-white/10 p-2.5 hover:bg-white/20"
            >
              <LayoutGrid className="size-4" aria-hidden />
            </button>
            {open && (
              // Anclado a la barra (no al botón): en el celular nunca se corta por la izquierda.
              <nav aria-label="Ir a" className="glass-card-menu fade-in absolute top-full right-2 z-50 mt-2 max-h-[70vh] w-72 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-xl py-2 text-ink">
                {groups.map((g) => (
                  <div key={g.id}>
                    <p className="px-4 pt-2 pb-1 text-[10px] font-bold tracking-wider text-ink-muted uppercase">{g.label}</p>
                    {g.items.map((item) => {
                      const Icon = NAV_ICONS[item.icon];
                      const active = item === current;
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          aria-current={active ? "page" : undefined}
                          className={`flex items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-brand-600/10 ${active ? "font-bold text-brand-600" : "font-medium"}`}
                        >
                          <Icon className="size-4 shrink-0 text-brand-600" aria-hidden />
                          {item.label}
                        </Link>
                      );
                    })}
                  </div>
                ))}
              </nav>
            )}
          </div>
        )}

        <NotificationBell />
        <UserMenu user={user} />
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
