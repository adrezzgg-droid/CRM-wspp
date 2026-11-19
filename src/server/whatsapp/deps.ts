import "server-only";
import { randomUUID } from "node:crypto";
import { adminBucket, adminDb } from "@/server/firebase/admin";
import { serverEnv } from "@/server/env";
import { fireAutomations } from "@/server/automations/run";
import { parseKey, SecretBoxError } from "./secret-box";
import type { GraphConfig } from "./graph";
import type { WebhookDeps } from "./webhook-core";

/** Clave de cifrado de secretos, o null si el servidor no la tiene configurada. */
export function secretKeyOrNull(): Buffer | null {
  try {
    return parseKey(serverEnv().SECRETS_ENCRYPTION_KEY);
  } catch (error) {
    if (error instanceof SecretBoxError) return null;
    throw error;
  }
}

export function graphConfig(token: string): GraphConfig {
  const env = serverEnv();
  return { token, version: env.WHATSAPP_GRAPH_API_VERSION, baseUrl: env.WHATSAPP_GRAPH_BASE_URL };
}

const safeName = (name: string) => name.normalize("NFKD").replace(/[^\w.-]+/g, "_").slice(-120) || "archivo";

/** Guarda un archivo de una conversación en Storage (solo el servidor accede). */
export async function storeConversationFile(orgId: string, conversationId: string, file: { bytes: Uint8Array; mimeType: string; fileName: string }) {
  const storagePath = `orgs/${orgId}/conversations/${conversationId}/${randomUUID()}/${safeName(file.fileName)}`;
  const buffer = Buffer.from(file.bytes);
  await adminBucket().file(storagePath).save(buffer, { contentType: file.mimeType, resumable: false });
  return { storagePath, size: buffer.length };
}

export function webhookDeps(): WebhookDeps {
  const env = serverEnv();
  return {
    db: adminDb(),
    globalAppSecret: env.WHATSAPP_APP_SECRET,
    globalVerifyToken: env.WHATSAPP_VERIFY_TOKEN,
    secretKey: secretKeyOrNull(),
    graph: { version: env.WHATSAPP_GRAPH_API_VERSION, baseUrl: env.WHATSAPP_GRAPH_BASE_URL },
    storeMedia: storeConversationFile,
    onNewConversation: (orgId, r) => fireAutomations(orgId, "mensaje_nuevo_contacto", { customerId: r.customerId, conversationId: r.conversationId }),
  };
}
