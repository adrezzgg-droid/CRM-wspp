/** Clases compartidas entre Server y Client Components (no puede vivir en un módulo "use client"). */
export const inputClass =
  "block w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-ink outline-none transition placeholder:text-slate-400 focus:border-cyan-500 focus:ring-[3px] focus:ring-cyan-500/20 disabled:bg-slate-100 disabled:text-ink-muted aria-[invalid=true]:border-red-400";

/**
 * Avatares con iniciales: degradados de la paleta de Impulse360 (índigo, cian, violeta, rosa),
 * siempre el mismo para el mismo nombre. Solo dan color, no identifican.
 */
const AVATARES = [
  "linear-gradient(135deg, #4F46E5 0%, #818CF8 100%)",
  "linear-gradient(135deg, #4F46E5 0%, #0891B2 100%)",
  "linear-gradient(135deg, #0E7490 0%, #06B6D4 100%)",
  "linear-gradient(135deg, #6D28D9 0%, #A78BFA 100%)",
  "linear-gradient(135deg, #3730A3 0%, #6366F1 100%)",
  "linear-gradient(135deg, #BE185D 0%, #EC4899 100%)",
];
export function avatarStyle(name: string): { background: string } {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { background: AVATARES[h % AVATARES.length] };
}
