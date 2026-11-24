"use client";

import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { colorScheme, THEME_COOKIE, THEME_LABELS, THEMES, themeClass, type Theme } from "@/lib/theme";

export const THEME_ICONS: Record<Theme, LucideIcon> = { claro: Sun, oscuro: Moon, sistema: Monitor };

/** Cambia el tema al instante (clase de <html>) y lo recuerda un año en la cookie. */
export function applyTheme(theme: Theme) {
  const html = document.documentElement;
  for (const t of THEMES) html.classList.remove(themeClass(t));
  html.classList.add(themeClass(theme));
  html.style.colorScheme = colorScheme(theme);
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=31536000; samesite=lax${location.protocol === "https:" ? "; secure" : ""}`;
}

/**
 * Botón de la barra superior, igual que Impulse360: cada click pasa a
 * claro → oscuro → sistema; el ícono muestra el tema actual.
 */
export function ThemeToggle({ theme, onChange }: { theme: Theme; onChange: (t: Theme) => void }) {
  const next = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
  const Icon = THEME_ICONS[theme];
  return (
    <button
      type="button"
      onClick={() => onChange(next)}
      title={`Tema: ${THEME_LABELS[theme]} (cambiar a ${THEME_LABELS[next]})`}
      aria-label={`Cambiar tema (ahora ${THEME_LABELS[theme]})`}
      className="grid shrink-0 place-items-center rounded-lg bg-white/10 p-2.5 text-[#F0EEE6] hover:bg-white/20"
    >
      <Icon className="size-4" aria-hidden />
    </button>
  );
}
