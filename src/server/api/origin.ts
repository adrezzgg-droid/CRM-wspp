/**
 * Protección CSRF para peticiones que modifican datos: el navegador siempre
 * manda `Origin` en POST/PUT/PATCH/DELETE, y tiene que ser el propio sitio.
 * Código puro para poder probarlo sin Next.
 */

export const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function isSameOrigin(
  origin: string | null,
  requestHost: string | null,
  appUrl?: string,
): boolean {
  if (!origin) return false;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return false;
  }
  if (requestHost && originHost === requestHost) return true;
  if (appUrl) {
    try {
      return originHost === new URL(appUrl).host;
    } catch {
      return false;
    }
  }
  return false;
}
