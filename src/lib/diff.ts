/** Cambios entre dos versiones de un documento, para guardar en el historial. Código puro. */

export type Changes = Record<string, { before: unknown; after: unknown }>;

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if ((a === undefined || a === null || a === "") && (b === undefined || b === null || b === "")) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && [...a].sort().join("\u0000") === [...b].sort().join("\u0000");
  }
  return false;
}

export function diffFields<T extends object>(before: T, after: Partial<T>, keys: readonly (keyof T)[]): Changes {
  const out: Changes = {};
  for (const key of keys) {
    if (!(key in after)) continue;
    const a = before[key];
    const b = after[key];
    if (!same(a, b)) out[key as string] = { before: a ?? null, after: b ?? null };
  }
  return out;
}
