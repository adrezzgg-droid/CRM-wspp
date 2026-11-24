"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { LogOut, Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { api, errorMessage } from "@/lib/api-client";
import { firebaseClient } from "@/lib/firebase/client";
import type { ShellUser } from "./app-shell";
import { avatarStyle } from "@/components/ui/styles";
import { colorScheme, THEME_COOKIE, THEME_LABELS, THEMES, themeClass, type Theme } from "@/lib/theme";

const THEME_ICONS: Record<Theme, LucideIcon> = { claro: Sun, oscuro: Moon, sistema: Monitor };

/** Cambia el tema al instante (clase de <html>) y lo recuerda un año en la cookie. */
function applyTheme(theme: Theme) {
  const html = document.documentElement;
  for (const t of THEMES) html.classList.remove(themeClass(t));
  html.classList.add(themeClass(theme));
  html.style.colorScheme = colorScheme(theme);
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=31536000; samesite=lax${location.protocol === "https:" ? "; secure" : ""}`;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

export function UserMenu({ user, theme: initialTheme }: { user: ShellUser; theme: Theme }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [busy, setBusy] = useState(false);
  const [availability, setAvailability] = useState<{ saving: boolean; error: string | null }>({ saving: false, error: null });

  async function toggleAvailable(available: boolean) {
    setAvailability({ saving: true, error: null });
    try {
      await api("POST", "/api/me/availability", { available });
      router.refresh();
      setAvailability({ saving: false, error: null });
    } catch (err) {
      setAvailability({ saving: false, error: errorMessage(err) });
    }
  }
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function logout() {
    setBusy(true);
    await fetch("/api/auth/session", { method: "DELETE" }).catch(() => undefined);
    await signOut(firebaseClient().auth).catch(() => undefined);
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-lg p-1 pr-2 text-[#F0EEE6] hover:bg-white/10"
      >
        <span className="relative grid size-8 place-items-center rounded-full text-xs font-bold text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)]" style={avatarStyle(user.displayName)}>
          {initials(user.displayName) || "?"}
          {user.available !== undefined && (
            <span
              className={`absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-panel ${user.available ? "bg-green-500" : "bg-slate-400"}`}
              title={user.available ? "Disponible" : "No disponible"}
            />
          )}
        </span>
        <span className="hidden text-left sm:block">
          <span className="block max-w-40 truncate text-sm font-medium">{user.displayName}</span>
          <span className="block text-xs text-slate-400">{user.roleLabel}</span>
        </span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-2 w-64 overflow-hidden glass-card-menu rounded-xl text-ink"
        >
          <div className="border-b border-line px-4 py-3">
            <p className="truncate text-sm font-medium">{user.displayName}</p>
            <p className="truncate text-xs text-ink-muted">{user.email}</p>
            <p className="mt-1 text-xs text-ink-muted">Rol: {user.roleLabel}</p>
          </div>
          {user.available !== undefined && (
            <div className="border-b border-line px-4 py-3">
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>
                  <span className="block font-medium">Disponible</span>
                  <span className="block text-xs text-ink-muted">Recibir leads nuevos automáticamente</span>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={user.available}
                  disabled={availability.saving}
                  onChange={(e) => toggleAvailable(e.target.checked)}
                  className="size-5 accent-brand-600"
                />
              </label>
              {availability.error && <p className="mt-1 text-xs text-red-600">{availability.error}</p>}
            </div>
          )}
          <div className="border-b border-line px-4 py-3">
            <p className="mb-2 text-xs font-bold tracking-wider text-ink-muted uppercase">Tema</p>
            <div role="radiogroup" aria-label="Tema" className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1">
              {THEMES.map((t) => {
                const Icon = THEME_ICONS[t];
                const active = t === theme;
                return (
                  <button
                    key={t}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => {
                      setTheme(t);
                      applyTheme(t);
                    }}
                    className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-semibold ${active ? "bg-surface text-brand-600 shadow-sm" : "text-ink-muted hover:text-ink"}`}
                  >
                    <Icon className="size-3.5" aria-hidden />
                    {THEME_LABELS[t]}
                  </button>
                );
              })}
            </div>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={logout}
            disabled={busy}
            className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-canvas disabled:opacity-60"
          >
            <LogOut className="size-4" aria-hidden />
            {busy ? "Cerrando sesión…" : "Cerrar sesión"}
          </button>
        </div>
      )}
    </div>
  );
}
