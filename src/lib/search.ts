/**
 * Búsqueda sin servicio externo: cada documento guarda `searchKeywords`
 * (prefijos normalizados) y la consulta usa `array-contains` con el término
 * más largo; el resto de los términos se filtra en memoria. Código puro.
 */

const MIN_PREFIX = 2;
const MAX_PREFIX = 15;

export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9@.\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function prefixes(word: string): string[] {
  const out: string[] = [];
  for (let i = MIN_PREFIX; i <= Math.min(word.length, MAX_PREFIX); i++) out.push(word.slice(0, i));
  return out;
}

/** Palabras de un texto libre (nombre, empresa, dirección...). */
function textKeywords(text: string | undefined): string[] {
  if (!text) return [];
  return normalizeText(text)
    .split(" ")
    .filter(Boolean)
    .flatMap((w) => prefixes(w.replace(/[@.]/g, "")));
}

/**
 * Teléfono: prefijos del número nacional (sin 54/549) y del wa_id completo,
 * prefijos del número local (sin código de área, que mide 6 a 8 dígitos según
 * la zona) y los últimos 4 dígitos, que es como se suele buscar.
 */
function phoneKeywords(waId: string | undefined, phone: string | undefined): string[] {
  const out: string[] = [];
  for (const raw of [waId, phone]) {
    const d = raw?.replace(/\D/g, "");
    if (!d || d.length < 6) continue;
    const national = d.replace(/^549?/, "").replace(/^0/, "");
    out.push(...prefixes(d).filter((p) => p.length >= 3), ...prefixes(national).filter((p) => p.length >= 3));
    for (const localLength of [6, 7, 8]) {
      if (national.length > localLength) out.push(...prefixes(national.slice(-localLength)).filter((p) => p.length >= 3));
    }
    out.push(d.slice(-4));
  }
  return out;
}

export interface SearchableCustomer {
  name: string;
  company?: string;
  phone?: string;
  whatsappId?: string;
  email?: string;
  address?: string;
  neighborhood?: string;
  locality?: string;
}

export function customerKeywords(c: SearchableCustomer): string[] {
  const set = new Set<string>([
    ...textKeywords(c.name),
    ...textKeywords(c.company),
    ...textKeywords(c.address),
    ...textKeywords(c.neighborhood),
    ...textKeywords(c.locality),
    ...textKeywords(c.email?.split("@")[0]),
    ...phoneKeywords(c.whatsappId, c.phone),
  ]);
  return [...set];
}

/** Términos de búsqueda normalizados, del más largo al más corto. */
export function queryTerms(q: string): string[] {
  // "351 555-1234" o "(351) 555.1234" es un solo número de teléfono.
  const joined = q.replace(/(\d)[\s.\-()]+(?=\d)/g, "$1");
  const terms = normalizeText(joined)
    .split(" ")
    .map((t) => (/^[\d.]+$/.test(t) ? t.replace(/\D/g, "") : t.replace(/[@.]/g, "")))
    .filter((t) => t.length >= MIN_PREFIX)
    .map((t) => t.slice(0, MAX_PREFIX));
  return [...new Set(terms)].sort((a, b) => b.length - a.length);
}

/** ¿El documento contiene todos los términos? (para filtrar en memoria). */
export function matchesAll(keywords: readonly string[], terms: readonly string[]): boolean {
  const set = new Set(keywords);
  return terms.every((t) => set.has(t));
}
