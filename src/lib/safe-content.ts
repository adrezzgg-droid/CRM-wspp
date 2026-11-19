/**
 * Reglas de seguridad para lo que viene de afuera. Código puro.
 */

/**
 * Destino interno seguro para redirigir después del login: una ruta propia
 * ("/inbox?c=…"). Rechaza "//otro.com", "/\otro.com" (los navegadores tratan
 * la barra invertida como "/") y caracteres de control.
 */
export function safeNextPath(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.startsWith("/")) return undefined;
  if (/^\/[/\\]/.test(value) || /[\\\u0000-\u001f\u007f]/.test(value)) return undefined;
  return value;
}

/** Tipos que el navegador puede mostrar sin riesgo de ejecutar código en nuestro dominio. */
const INLINE_TYPES = /^(image\/(jpeg|png|webp|gif)|audio\/[\w.+-]+|video\/[\w.+-]+|application\/pdf)$/i;

/**
 * Cómo servir un archivo que mandó un cliente (o un usuario). Un HTML o SVG
 * abierto en línea correría en el dominio del CRM con la sesión de quien lo
 * abre: todo lo que no sea imagen/audio/video/PDF se descarga, y siempre con
 * una política que no deja ejecutar nada.
 */
export function attachmentHeaders(mimeType: string, fileName: string, wantDownload: boolean): Record<string, string> {
  const base = mimeType.split(";")[0].trim().toLowerCase();
  const inline = !wantDownload && INLINE_TYPES.test(base);
  const safeName = encodeURIComponent(fileName.replace(/[\r\n"]/g, "_"));
  return {
    "Content-Type": inline ? base : "application/octet-stream",
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${safeName}`,
    "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, max-age=3600",
  };
}
