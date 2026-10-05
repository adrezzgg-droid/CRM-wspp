import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import type { z } from "zod";
import type { Customer, Lead } from "@/types/model";
import { CUSTOMER_STAGE_LABELS, LEAD_STATUS_LABELS, orgPath } from "@/types/model";
import { adminDb } from "@/server/firebase/admin";
import { ApiError } from "@/server/api/handler";
import { recordActivityIn } from "@/server/audit";
import { can } from "@/server/permissions/matrix";
import { scopeAllows } from "@/server/permissions/scope";
import type { Session } from "@/server/auth/session";
import { scopeContext } from "@/server/org/data";
import type { leadStatusInput } from "@/lib/schemas";

const col = (orgId: string, c: Parameters<typeof orgPath>[1]) => adminDb().collection(orgPath(orgId, c));

/**
 * Cambio manual del estado del lead (trazabilidad: recibido → … → venta).
 * Lo hace quien atiende la bandeja; queda la fecha de cada paso y el historial.
 * Una venta convierte al prospecto en cliente nuevo.
 */
export async function updateLeadStatus(session: Session, leadId: string, input: z.output<typeof leadStatusInput>): Promise<Lead> {
  if (!can(session.role, "inbox", "editar", session.overrides)) throw new ApiError(403, "No tenés permiso para cambiar el estado del lead");
  const ref = col(session.orgId, "leads").doc(leadId);
  const snap = await ref.get();
  if (!snap.exists) throw new ApiError(404, "Lead no encontrado");
  const lead = { ...(snap.data() as Lead), id: snap.id };
  if (!scopeAllows(await scopeContext(session, "inbox"), lead.ownerId ?? null)) throw new ApiError(404, "Lead no encontrado");
  if (lead.status === input.status && (input.status !== "perdido" || lead.lostReason === input.lostReason)) return lead;

  const now = Date.now();
  await adminDb().runTransaction(async (tx) => {
    const customerRef = col(session.orgId, "customers").doc(lead.customerId);
    const converts = input.status === "venta_realizada";
    const customer = converts ? ((await tx.get(customerRef)).data() as Customer | undefined) : undefined;
    const becomesClient = converts && customer?.stage === "prospecto";
    const conversations = becomesClient ? await tx.get(col(session.orgId, "conversations").where("customerId", "==", lead.customerId)) : null;

    tx.update(ref, {
      status: input.status,
      [`statusAt.${input.status}`]: now,
      lostReason: input.status === "perdido" ? input.lostReason : FieldValue.delete(),
      updatedAt: now,
      updatedBy: session.uid,
    });
    recordActivityIn(tx, {
      orgId: session.orgId,
      isDemo: session.org.isDemo,
      customerId: lead.customerId,
      conversationId: lead.conversationId,
      leadId,
      kind: "lead.estado",
      summary: `Lead: ${LEAD_STATUS_LABELS[input.status]}${input.status === "perdido" ? ` — ${input.lostReason}` : ""}`,
      actorId: session.uid,
      data: { leadStatus: { before: lead.status, after: input.status } },
    }, now);

    if (becomesClient) {
      tx.update(customerRef, { stage: "cliente_nuevo", updatedAt: now, updatedBy: session.uid });
      for (const c of conversations?.docs ?? []) tx.update(c.ref, { customerStage: "cliente_nuevo" });
      recordActivityIn(tx, {
        orgId: session.orgId,
        isDemo: session.org.isDemo,
        customerId: lead.customerId,
        leadId,
        kind: "cliente.etapa",
        summary: `Etapa: ${CUSTOMER_STAGE_LABELS.cliente_nuevo} (primera venta)`,
        actorId: session.uid,
        data: { stage: { before: "prospecto", after: "cliente_nuevo" } },
      }, now);
    }
  });
  return { ...lead, status: input.status, statusAt: { ...lead.statusAt, [input.status]: now } };
}
