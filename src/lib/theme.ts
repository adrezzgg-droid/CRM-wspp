/**
 * Tema visual (como Impulse360): claro, oscuro o el del sistema operativo.
 * Se guarda en una cookie no sensible para que el servidor pinte la página ya
 * con el tema correcto (sin parpadeo). Por defecto sigue al sistema.
 */
export const THEME_COOKIE = "tema";

export const THEMES = ["claro", "oscuro", "sistema"] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_LABELS: Record<Theme, string> = { claro: "Claro", oscuro: "Oscuro", sistema: "Sistema" };

export function parseTheme(value: string | undefined | null): Theme {
  return THEMES.includes(value as Theme) ? (value as Theme) : "sistema";
}

/** Clase que va en <html>; globals.css la usa para la variante `dark:`. */
export function themeClass(theme: Theme): string {
  return `tema-${theme}`;
}

/** Valor de `color-scheme` (controles nativos, barras de desplazamiento). */
export function colorScheme(theme: Theme): string {
  return theme === "claro" ? "light" : theme === "oscuro" ? "dark" : "light dark";
}
