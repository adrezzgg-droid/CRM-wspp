import "server-only";
import { cache } from "react";
import type { DocumentReference, QuerySnapshot, Transaction } from "firebase-admin/firestore";
import type { Customer, Lead, LeadStatus, Pipeline, PipelineStage } from "@/types/model";
import { CUSTOMER_STAGE_LABELS, LEAD_STATUS_LABELS, orgPath } from "@/types/model";
import { adminDb } from "@/server/firebase/admin";
import { recordActivityIn } from "@/server/audit";
import type { Session } from "@/server/auth/session";
import { advanceLead } from "@/lib/assignment";
import { DEFAULT_PIPELINE_ID, DEFAULT_PIPELINE_STAGES } from "@/server/org/defaults";

export const col = (orgId: string, c: Parameters<typeof orgPath>[1]) => adminDb().collection(orgPath(orgId, c));

/** Pipeline principal de la empresa (con las etapas por defecto si no existe). */
export const getPipeline = cache(async (orgId: string): Promise<Pipeline & { stages: PipelineStage[] }> => {
  const snap = await col(orgId, "pipelines").doc(DEFAULT_PIPELINE_ID).get();
  const data = snap.data() as Pipeline | undefined;
  const stages = [...(data?.stages ?? DEFAULT_PIPELINE_STAGES)].sort((a, b) => a.order - b.order);
  return { ...(data ?? ({} as Pipeline)), id: DEFAULT_PIPELINE_ID, name: data?.name ?? "Pipeline comercial", stages };
});

/**
 * Efectos sobre el lead y el cliente que se aplican dentro de una transacción.
 * Las transacciones exigen leer todo antes de escribir: `read` hace las
 * lecturas y devuelve `write`, que hace las escrituras.
 */
export interface LeadEffect {
  /** Estado al que llevar el lead (avanza; "perdido" solo si no hubo venta). */
  to: LeadStatus;
  lostReason?: string;
}

export async function readCommercialEffects(
  tx: Transaction,
  session: Session,
  input: { leadId?: string; customerId: string; convertProspect: boolean },
) {
  const leadRef: DocumentReference | null = input.leadId ? col(session.orgId, "leads").doc(input.leadId) : null;
  const customerRef = col(session.orgId, "customers").doc(input.customerId);
  const [leadSnap, customerSnap] = await Promise.all([leadRef ? tx.get(leadRef) : Promise.resolve(null), tx.get(customerRef)]);
  const lead = leadSnap?.data() as Lead | undefined;
  const customer = customerSnap.data() as Customer | undefined;
  const converts = input.convertProspect && customer?.stage === "prospecto";
  const conversations: QuerySnapshot | null = converts
    ? await tx.get(col(session.orgId, "conversations").where("customerId", "==", input.customerId))
    : null;

  return {
    lead,
    customer,
    customerRef,
    /** Escrituras: avanzar el lead y, si corresponde, convertir al prospecto en cliente nuevo. */
    write(effect: LeadEffect | null, now: number, context: { orderId?: string; opportunityId?: string } = {}) {
      if (leadRef && lead && effect) {
        const next =
          effect.to === "perdido"
            ? lead.status === "venta_realizada" || lead.status === "cerrado"
              ? lead.status
              : "perdido"
            : advanceLead(lead.status, effect.to);
        if (next !== lead.status) {
          tx.update(leadRef, {
            status: next,
            [`statusAt.${next}`]: now,
            ...(next === "perdido" && effect.lostReason ? { lostReason: effect.lostReason } : {}),
            updatedAt: now,
            updatedBy: session.uid,
          });
          recordActivityIn(tx, {
            orgId: session.orgId,
            isDemo: session.org.isDemo,
            customerId: input.customerId,
            leadId: input.leadId,
            ...context,
            kind: "lead.estado",
            summary: `Lead: ${LEAD_STATUS_LABELS[next]}`,
            actorId: session.uid,
            data: { leadStatus: { before: lead.status, after: next } },
          }, now);
        }
      }
      if (converts) {
        tx.update(customerRef, { stage: "cliente_nuevo", updatedAt: now, updatedBy: session.uid });
        for (const c of conversations?.docs ?? []) tx.update(c.ref, { customerStage: "cliente_nuevo" });
        recordActivityIn(tx, {
          orgId: session.orgId,
          isDemo: session.org.isDemo,
          customerId: input.customerId,
          ...context,
          kind: "cliente.etapa",
          summary: `Etapa: ${CUSTOMER_STAGE_LABELS.cliente_nuevo} (primera compra)`,
          actorId: session.uid,
          data: { stage: { before: "prospecto", after: "cliente_nuevo" } },
        }, now);
      }
    },
  };
}
