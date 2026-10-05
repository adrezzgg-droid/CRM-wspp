import "server-only";
import { adminDb } from "@/server/firebase/admin";
import { senderFor } from "@/server/inbox/sender";
import { runEventAutomations, runScheduledAutomations, runScheduledAutomationsAll, type AutomationContext, type EngineDeps } from "./engine-core";

/** Dependencias reales del motor: Firestore del servidor y el emisor de la organización. */
export function engineDeps(): EngineDeps {
  return {
    db: adminDb(),
    send: (org, to, payload) => (payload.template ? senderFor(org).sendTemplate(to, payload.template) : senderFor(org).sendText(to, payload.text)),
  };
}

/**
 * Dispara las automatizaciones de un evento DESPUÉS de que el cambio ya se
 * guardó. Si una automatización falla, el pedido o el mensaje no se pierden:
 * el error queda en el registro de ejecuciones y en el log.
 */
export async function fireAutomations(orgId: string, trigger: "mensaje_nuevo_contacto" | "pedido_creado", ctx: AutomationContext): Promise<void> {
  try {
    await runEventAutomations(engineDeps(), orgId, trigger, ctx);
  } catch (error) {
    console.error(`[automatizaciones] ${trigger}`, error);
  }
}

export const runScheduledForOrg = (orgId: string) => runScheduledAutomations(engineDeps(), orgId);
export const runScheduledForAll = () => runScheduledAutomationsAll(engineDeps());
