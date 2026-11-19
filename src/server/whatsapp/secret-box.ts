/**
 * Cifrado de secretos en reposo (Access Token de WhatsApp, App Secret, claves
 * de conectores) con AES-256-GCM.
 *
 * Código puro (solo node:crypto) para poder probarlo sin Next. La clave viene
 * de SECRETS_ENCRYPTION_KEY (32 bytes en base64) y nunca se guarda en la base.
 *
 * Formato: "v1.<iv>.<tag>.<texto cifrado>" en base64url. El "contexto" (p.ej.
 * "org-123:whatsapp.accessToken") va como dato autenticado: un valor cifrado
 * copiado a otra empresa u otro campo no se puede descifrar.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";

export class SecretBoxError extends Error {}

export function parseKey(base64: string | undefined): Buffer {
  if (!base64) throw new SecretBoxError("Falta SECRETS_ENCRYPTION_KEY: no se pueden guardar credenciales.");
  const key = Buffer.from(base64, "base64");
  if (key.length !== 32) throw new SecretBoxError("SECRETS_ENCRYPTION_KEY tiene que tener 32 bytes en base64.");
  return key;
}

export function seal(plain: string, key: Buffer, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

export function open(sealed: string, key: Buffer, context: string): string {
  const [version, iv, tag, ct] = sealed.split(".");
  if (version !== VERSION || !iv || !tag || ct === undefined) throw new SecretBoxError("Formato de secreto desconocido");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new SecretBoxError("No se pudo descifrar el secreto (clave distinta o dato alterado)");
  }
}

/** Últimos 4 caracteres, para mostrar qué token quedó cargado sin revelarlo. */
export const lastFour = (s: string) => (s.length > 8 ? s.slice(-4) : "");
