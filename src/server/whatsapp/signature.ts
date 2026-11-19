/**
 * Firma HMAC-SHA256 de los webhooks. Meta la manda en `X-Hub-Signature-256`
 * ("sha256=<hex>") calculada sobre el cuerpo CRUDO con el App Secret. El
 * conector de gestión usa el mismo esquema en las dos direcciones.
 * Código puro.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export function signBody(rawBody: string | Uint8Array, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

/** Comparación en tiempo constante; cualquier formato raro es inválido. */
export function verifySignature(rawBody: string | Uint8Array, header: string | null | undefined, secret: string | undefined): boolean {
  if (!header || !secret || !/^sha256=[0-9a-f]{64}$/i.test(header)) return false;
  const expected = Buffer.from(signBody(rawBody, secret));
  const got = Buffer.from(header.toLowerCase());
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/** Hash para indexar un token sin guardarlo (p.ej. el Verify Token del webhook). */
export const sha256Hex = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
