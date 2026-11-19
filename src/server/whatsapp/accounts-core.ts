/**
 * Credenciales y enrutamiento de las cuentas de WhatsApp. Sin Next: lo usan
 * el webhook, el emisor y las pruebas contra el emulador.
 *
 *  - `organizations/{orgId}/whatsappAccounts/principal`: datos públicos.
 *  - `organizations/{orgId}/secrets/whatsapp`: token, App Secret y Verify
 *    Token cifrados (reglas: nadie los lee desde el navegador).
 *  - `whatsappRoutes/{phone_<id>|waba_<id>}` (raíz): número/cuenta → empresa.
 *  - `whatsappVerifyTokens/{sha256}` (raíz): Verify Token → empresa (el GET de
 *    verificación de Meta no dice de qué número es).
 */
import type { Firestore } from "firebase-admin/firestore";
import type { WhatsappAccount, WhatsappRoute, WhatsappSecrets } from "../../types/model.ts";
import { open } from "./secret-box.ts";

export const PRIMARY_ACCOUNT_ID = "principal";
export const ROUTES = "whatsappRoutes";
export const VERIFY_TOKENS = "whatsappVerifyTokens";

export const phoneRoute = (phoneNumberId: string) => `phone_${phoneNumberId}`;
export const wabaRoute = (wabaId: string) => `waba_${wabaId}`;

/** Dato autenticado del cifrado: ata cada secreto a su empresa y su campo. */
export const secretContext = (orgId: string, field: "accessToken" | "appSecret" | "verifyToken") => `${orgId}:whatsapp.${field}`;

export interface CloudCredentials {
  account: WhatsappAccount;
  accessToken: string;
  appSecret?: string;
}

export async function readAccount(db: Firestore, orgId: string, accountId = PRIMARY_ACCOUNT_ID): Promise<WhatsappAccount | null> {
  const snap = await db.collection("organizations").doc(orgId).collection("whatsappAccounts").doc(accountId).get();
  return snap.exists ? ({ ...(snap.data() as WhatsappAccount), id: snap.id }) : null;
}

/** Secretos descifrados (los que estén cargados). */
export async function readSecrets(db: Firestore, orgId: string, key: Buffer | null): Promise<{ accessToken?: string; appSecret?: string; verifyToken?: string }> {
  const snap = await db.collection("organizations").doc(orgId).collection("secrets").doc("whatsapp").get();
  const s = snap.data() as WhatsappSecrets | undefined;
  if (!s || !key) return {};
  return {
    accessToken: s.accessToken ? open(s.accessToken, key, secretContext(orgId, "accessToken")) : undefined,
    appSecret: s.appSecret ? open(s.appSecret, key, secretContext(orgId, "appSecret")) : undefined,
    verifyToken: s.verifyToken ? open(s.verifyToken, key, secretContext(orgId, "verifyToken")) : undefined,
  };
}

/** Cuenta conectada con su token, o null si la empresa no configuró WhatsApp. */
export async function readCredentials(db: Firestore, orgId: string, key: Buffer | null): Promise<CloudCredentials | null> {
  const account = await readAccount(db, orgId);
  if (!account?.tokenSet) return null;
  const { accessToken, appSecret } = await readSecrets(db, orgId, key);
  return accessToken ? { account, accessToken, appSecret } : null;
}

export async function resolveRoutes(db: Firestore, keys: readonly string[]): Promise<Map<string, WhatsappRoute>> {
  const unique = [...new Set(keys)];
  if (!unique.length) return new Map();
  const snaps = await db.getAll(...unique.map((k) => db.collection(ROUTES).doc(k)));
  return new Map(snaps.filter((s) => s.exists).map((s) => [s.id, s.data() as WhatsappRoute]));
}
