import "server-only";
import { randomBytes } from "node:crypto";
import type { z } from "zod";
import type { WhatsappAccount, WhatsappRoute, WhatsappSecrets } from "@/types/model";
import { orgPath } from "@/types/model";
import { adminDb } from "@/server/firebase/admin";
import { serverEnv } from "@/server/env";
import { ApiError } from "@/server/api/handler";
import { recordAuditIn } from "@/server/audit";
import { can, type Action } from "@/server/permissions/matrix";
import type { Session } from "@/server/auth/session";
import type { whatsappConfigInput } from "@/lib/schemas";
import { lastFour, seal } from "./secret-box";
import { sha256Hex } from "./signature";
import { explainGraphError, phoneInfo, subscribeApp, type GraphConfig } from "./graph";
import { PRIMARY_ACCOUNT_ID, phoneRoute, readAccount, readCredentials, readSecrets, ROUTES, secretContext, VERIFY_TOKENS, wabaRoute, type CloudCredentials } from "./accounts-core";
import { graphConfig, secretKeyOrNull } from "./deps";

const accountRef = (orgId: string) => adminDb().collection(orgPath(orgId, "whatsappAccounts")).doc(PRIMARY_ACCOUNT_ID);
const secretsRef = (orgId: string) => adminDb().collection(orgPath(orgId, "secrets")).doc("whatsapp");

function requirePerm(session: Session, action: Action) {
  if (!can(session.role, "whatsapp_config", action, session.overrides)) throw new ApiError(403, "Solo un administrador configura WhatsApp");
}

function requireKey(): Buffer {
  const key = secretKeyOrNull();
  if (!key) throw new ApiError(503, "El servidor no tiene SECRETS_ENCRYPTION_KEY: sin esa clave no se pueden guardar credenciales de WhatsApp.");
  return key;
}

// ───────────────────────────── Uso interno ──────────────────────────────────

/** Credenciales de la empresa para hablar con Meta. 503 si WhatsApp no está conectado. */
export async function cloudCredentials(orgId: string): Promise<CloudCredentials> {
  const creds = await readCredentials(adminDb(), orgId, secretKeyOrNull());
  if (!creds) throw new ApiError(503, "WhatsApp no está conectado para esta empresa. Un administrador lo conecta en Configuración → WhatsApp.");
  return creds;
}

/**
 * Llamada a Meta con las credenciales de la empresa. Los errores se traducen
 * a mensajes para el equipo; si el token venció, la cuenta queda en error
 * (se ve en Configuración → WhatsApp) para que alguien lo renueve.
 */
export async function withGraph<T>(orgId: string, fn: (cfg: GraphConfig, creds: CloudCredentials) => Promise<T>): Promise<T> {
  const creds = await cloudCredentials(orgId);
  try {
    return await fn(graphConfig(creds.accessToken), creds);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const e = explainGraphError(error);
    console.error(`[whatsapp] ${orgId}`, error);
    if (e.reconnect) await accountRef(orgId).update({ connectionStatus: "error", lastError: e.message, lastCheckedAt: Date.now() }).catch(() => undefined);
    throw new ApiError(e.status, e.message);
  }
}

// ──────────────────────────── Configuración ─────────────────────────────────

export interface WhatsappSettingsView {
  isDemo: boolean;
  canEdit: boolean;
  /** El servidor puede cifrar credenciales (SECRETS_ENCRYPTION_KEY). */
  encryptionReady: boolean;
  /** Hay App Secret de la plataforma (WHATSAPP_APP_SECRET). */
  platformSecretReady: boolean;
  webhookUrl: string;
  /** Verify Token de esta empresa para pegar en Meta (solo administradores). */
  verifyToken: string | null;
  account: Pick<
    WhatsappAccount,
    | "phoneNumberId"
    | "wabaId"
    | "displayPhone"
    | "verifiedName"
    | "qualityRating"
    | "connectionStatus"
    | "webhookStatus"
    | "tokenSet"
    | "tokenLast4"
    | "appSecretSet"
    | "lastError"
    | "lastCheckedAt"
    | "webhookVerifiedAt"
    | "lastWebhookAt"
  > | null;
}

export async function getWhatsappSettings(session: Session): Promise<WhatsappSettingsView> {
  requirePerm(session, "ver");
  const env = serverEnv();
  const key = secretKeyOrNull();
  const account = session.org.isDemo ? null : await readAccount(adminDb(), session.orgId);
  const secrets = account && key ? await readSecrets(adminDb(), session.orgId, key).catch(() => ({ verifyToken: undefined })) : {};
  return {
    isDemo: session.org.isDemo,
    canEdit: can(session.role, "whatsapp_config", "editar", session.overrides),
    encryptionReady: !!key,
    platformSecretReady: !!env.WHATSAPP_APP_SECRET,
    webhookUrl: `${(env.APP_URL ?? "").replace(/\/$/, "")}/api/webhooks/whatsapp`,
    verifyToken: secrets.verifyToken ?? null,
    account: account
      ? {
          phoneNumberId: account.phoneNumberId,
          wabaId: account.wabaId,
          displayPhone: account.displayPhone,
          verifiedName: account.verifiedName,
          qualityRating: account.qualityRating,
          connectionStatus: account.connectionStatus,
          webhookStatus: account.webhookStatus,
          tokenSet: account.tokenSet,
          tokenLast4: account.tokenLast4,
          appSecretSet: account.appSecretSet,
          lastError: account.lastError,
          lastCheckedAt: account.lastCheckedAt,
          webhookVerifiedAt: account.webhookVerifiedAt,
          lastWebhookAt: account.lastWebhookAt,
        }
      : null,
  };
}

/**
 * Conectar (o actualizar) el número. Primero se prueba contra Meta con los
 * datos nuevos; si Meta los rechaza, no se guarda nada.
 */
export async function saveWhatsappConfig(session: Session, input: z.output<typeof whatsappConfigInput>): Promise<WhatsappSettingsView> {
  requirePerm(session, "editar");
  if (session.org.isDemo) throw new ApiError(409, "El demo nunca se conecta a Meta: los mensajes se simulan.");
  const key = requireKey();
  const db = adminDb();
  const orgId = session.orgId;
  const [previous, stored] = await Promise.all([readAccount(db, orgId), readSecrets(db, orgId, key)]);
  const accessToken = input.accessToken ?? stored.accessToken;
  if (!accessToken) throw new ApiError(422, "Falta el Access Token", [{ path: ["accessToken"], message: "Pegá el token permanente del usuario del sistema" }]);
  const appSecret = input.clearAppSecret ? undefined : (input.appSecret ?? stored.appSecret);
  if (!appSecret && !serverEnv().WHATSAPP_APP_SECRET) {
    throw new ApiError(422, "Falta el App Secret de tu app de Meta (el servidor no tiene uno de plataforma)", [{ path: ["appSecret"], message: "Obligatorio en esta instalación" }]);
  }

  // Prueba contra Meta: el número existe para ese token y la app queda suscripta a la cuenta.
  const cfg = graphConfig(accessToken);
  let info: Awaited<ReturnType<typeof phoneInfo>>;
  try {
    info = await phoneInfo(cfg, input.phoneNumberId);
  } catch (error) {
    throw new ApiError(422, `Meta no acepta esos datos: ${explainGraphError(error).message}`, [{ path: ["phoneNumberId"], message: "Revisá el Phone Number ID y el token" }]);
  }
  try {
    await subscribeApp(cfg, input.wabaId);
  } catch (error) {
    throw new ApiError(422, `No se pudo suscribir la app a la cuenta de WhatsApp Business: ${explainGraphError(error).message}`, [{ path: ["wabaId"], message: "Revisá el WABA ID" }]);
  }

  const now = Date.now();
  const verifyToken = stored.verifyToken ?? randomBytes(24).toString("base64url");
  const newRoutes = [phoneRoute(input.phoneNumberId), wabaRoute(input.wabaId)];
  const oldRoutes = previous?.tokenSet ? [phoneRoute(previous.phoneNumberId), wabaRoute(previous.wabaId)].filter((r) => !newRoutes.includes(r)) : [];

  await db.runTransaction(async (tx) => {
    const routeSnaps = await Promise.all(newRoutes.map((r) => tx.get(db.collection(ROUTES).doc(r))));
    const taken = routeSnaps.find((s) => s.exists && (s.data() as WhatsappRoute).orgId !== orgId);
    if (taken) throw new ApiError(409, taken.id.startsWith("phone_") ? "Ese número ya está conectado a otra empresa del CRM" : "Esa cuenta de WhatsApp Business ya está conectada a otra empresa del CRM");

    for (const r of oldRoutes) tx.delete(db.collection(ROUTES).doc(r));
    newRoutes.forEach((r, i) => tx.set(db.collection(ROUTES).doc(r), { orgId, accountId: PRIMARY_ACCOUNT_ID, kind: i === 0 ? "phone" : "waba", createdAt: now } satisfies WhatsappRoute));
    tx.set(db.collection(VERIFY_TOKENS).doc(sha256Hex(verifyToken)), { orgId, accountId: PRIMARY_ACCOUNT_ID, createdAt: now });

    const secrets: WhatsappSecrets = {
      accessToken: seal(accessToken, key, secretContext(orgId, "accessToken")),
      ...(appSecret ? { appSecret: seal(appSecret, key, secretContext(orgId, "appSecret")) } : {}),
      verifyToken: seal(verifyToken, key, secretContext(orgId, "verifyToken")),
      updatedAt: now,
      updatedBy: session.uid,
    };
    tx.set(secretsRef(orgId), secrets);

    const account: WhatsappAccount = {
      id: PRIMARY_ACCOUNT_ID,
      orgId,
      isDemo: false,
      displayPhone: info.display_phone_number ?? previous?.displayPhone ?? input.phoneNumberId,
      phoneNumberId: input.phoneNumberId,
      wabaId: input.wabaId,
      verifyTokenSet: true,
      tokenSet: true,
      tokenLast4: lastFour(accessToken),
      appSecretSet: !!appSecret,
      verifiedName: info.verified_name,
      qualityRating: info.quality_rating,
      connectionStatus: "conectado",
      webhookStatus: previous?.webhookStatus === "verificado" && previous.phoneNumberId === input.phoneNumberId ? "verificado" : "sin_verificar",
      ...(previous?.webhookVerifiedAt ? { webhookVerifiedAt: previous.webhookVerifiedAt } : {}),
      ...(previous?.lastWebhookAt ? { lastWebhookAt: previous.lastWebhookAt } : {}),
      lastCheckedAt: now,
      createdAt: previous?.createdAt ?? now,
      createdBy: previous?.createdBy ?? session.uid,
      updatedAt: now,
      updatedBy: session.uid,
    };
    tx.set(accountRef(orgId), account);
    // Auditoría SIN secretos: solo qué cambió y los últimos 4 del token.
    recordAuditIn(tx, {
      orgId,
      isDemo: false,
      actorId: session.uid,
      action: previous?.tokenSet ? "whatsapp.updated" : "whatsapp.connected",
      target: { collection: "whatsappAccounts", id: PRIMARY_ACCOUNT_ID },
      before: previous ? { phoneNumberId: previous.phoneNumberId, wabaId: previous.wabaId, tokenLast4: previous.tokenLast4 ?? null, appSecretSet: !!previous.appSecretSet } : undefined,
      after: { phoneNumberId: input.phoneNumberId, wabaId: input.wabaId, tokenLast4: account.tokenLast4, appSecretSet: !!appSecret, tokenChanged: !!input.accessToken },
    }, now);
  });
  return getWhatsappSettings(session);
}

/** Probar la conexión con el token guardado (y refrescar nombre y calidad del número). */
export async function testWhatsappConnection(session: Session): Promise<WhatsappSettingsView> {
  requirePerm(session, "editar");
  if (session.org.isDemo) throw new ApiError(409, "El demo nunca se conecta a Meta.");
  const now = Date.now();
  const info = await withGraph(session.orgId, async (cfg, creds) => {
    const i = await phoneInfo(cfg, creds.account.phoneNumberId);
    await subscribeApp(cfg, creds.account.wabaId);
    return i;
  });
  await accountRef(session.orgId).update({
    connectionStatus: "conectado",
    lastError: null,
    lastCheckedAt: now,
    ...(info.display_phone_number ? { displayPhone: info.display_phone_number } : {}),
    ...(info.verified_name ? { verifiedName: info.verified_name } : {}),
    ...(info.quality_rating ? { qualityRating: info.quality_rating } : {}),
  });
  return getWhatsappSettings(session);
}

/** Desconectar: se borran los secretos y el enrutamiento. Las conversaciones quedan. */
export async function disconnectWhatsapp(session: Session): Promise<WhatsappSettingsView> {
  requirePerm(session, "eliminar");
  if (session.org.isDemo) throw new ApiError(409, "El demo nunca se conecta a Meta.");
  const db = adminDb();
  const key = secretKeyOrNull();
  const account = await readAccount(db, session.orgId);
  if (!account?.tokenSet) return getWhatsappSettings(session);
  const { verifyToken } = key ? await readSecrets(db, session.orgId, key).catch(() => ({ verifyToken: undefined })) : { verifyToken: undefined };
  const now = Date.now();
  const batch = db.batch();
  batch.delete(db.collection(ROUTES).doc(phoneRoute(account.phoneNumberId)));
  batch.delete(db.collection(ROUTES).doc(wabaRoute(account.wabaId)));
  if (verifyToken) batch.delete(db.collection(VERIFY_TOKENS).doc(sha256Hex(verifyToken)));
  batch.delete(secretsRef(session.orgId));
  batch.update(accountRef(session.orgId), {
    tokenSet: false,
    verifyTokenSet: false,
    appSecretSet: false,
    tokenLast4: null,
    connectionStatus: "sin_configurar",
    webhookStatus: "sin_verificar",
    updatedAt: now,
    updatedBy: session.uid,
  });
  recordAuditIn(batch, {
    orgId: session.orgId,
    isDemo: false,
    actorId: session.uid,
    action: "whatsapp.disconnected",
    target: { collection: "whatsappAccounts", id: PRIMARY_ACCOUNT_ID },
    before: { phoneNumberId: account.phoneNumberId, wabaId: account.wabaId },
  }, now);
  await batch.commit();
  return getWhatsappSettings(session);
}
