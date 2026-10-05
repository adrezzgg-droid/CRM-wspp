import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import type { z } from "zod";
import type { Opportunity } from "@/types/model";
import { adminDb } from "@/server/firebase/admin";
import { ApiError } from "@/server/api/handler";
import { recordActivityIn, type ActivityEntry } from "@/server/audit";
import { can, type Action } from "@/server/permissions/matrix";
import { scopeAllows } from "@/server/permissions/scope";
import type { Session } from "@/server/auth/session";
import { getMembers, OWNER_ROLES, scopeContext } from "@/server/org/data";
import { getAccessibleCustomer } from "@/server/customers/service";
import { diffFields } from "@/lib/diff";
import { leadStatusForStage } from "@/lib/pipeline";
import { normalizeText } from "@/lib/search";
import type { opportunityInput, opportunityUpdate } from "@/lib/schemas";
import { col, getPipeline, readCommercialEffects } from "./common";

type CreateInput = z.output<typeof opportunityInput>;
type UpdateInput = z.output<typeof opportunityUpdate>;

/** Oportunidades cerradas que se siguen mostrando en el tablero. */
const CLOSED_VISIBLE_DAYS = 30;

function requirePipeline(session: Session, action: Action) {
  if (!can(session.role, "pipeline", action, session.overrides)) throw new ApiError(403, "No tenés permiso para esta acción en el pipeline");
}

function activity(session: Session, o: Pick<Opportunity, "id" | "customerId" | "leadId">, kind: string, summary: string, data?: Record<string, unknown>): ActivityEntry {
  return { orgId: session.orgId, isDemo: session.org.isDemo, customerId: o.customerId, leadId: o.leadId, opportunityId: o.id, kind, summary, actorId: session.uid, data };
}

export async function loadOpportunity(session: Session, id: string, action: Action = "ver"): Promise<Opportunity> {
  requirePipeline(session, action);
  const snap = await col(session.orgId, "opportunities").doc(id).get();
  if (!snap.exists) throw new ApiError(404, "Oportunidad no encontrada");
  const o = { ...(snap.data() as Opportunity), id: snap.id };
  if (!scopeAllows(await scopeContext(session, "pipeline"), o.ownerId)) throw new ApiError(404, "Oportunidad no encontrada");
  return o;
}

/** Responsable válido: dentro del alcance; quien solo ve lo propio, solo para sí. */
async function resolveOwner(session: Session, requested: string | undefined, fallback: string | null): Promise<string> {
  const ctx = await scopeContext(session, "pipeline");
  if (ctx.scope === "propio") {
    if (requested && requested !== session.uid) throw new ApiError(403, "No podés asignar oportunidades a otro usuario");
    return session.uid;
  }
  const ownerId = requested ?? fallback ?? session.uid;
  const member = (await getMembers(session.orgId)).find((m) => m.id === ownerId);
  if (!member?.active || !OWNER_ROLES.has(member.role)) throw new ApiError(422, "El responsable no es un usuario activo", [{ path: ["ownerId"], message: "Responsable inválido" }]);
  if (!scopeAllows(ctx, ownerId)) throw new ApiError(403, "Solo podés asignar dentro de tu equipo");
  return ownerId;
}

export interface OpportunityFilters {
  owner?: string;
  q?: string;
}

/** Oportunidades del tablero: abiertas y cerradas en los últimos 30 días. */
export async function listOpportunities(session: Session, f: OpportunityFilters = {}): Promise<Opportunity[]> {
  requirePipeline(session, "ver");
  const ctx = await scopeContext(session, "pipeline");
  let q = col(session.orgId, "opportunities").where("pipelineId", "==", "principal");
  if (f.owner) {
    if (!scopeAllows(ctx, f.owner)) return [];
    q = q.where("ownerId", "==", f.owner);
  } else if (ctx.scope === "propio") {
    q = q.where("ownerId", "==", session.uid);
  } else if (ctx.scope === "equipo" && ctx.teamUids.length <= 30) {
    q = q.where("ownerId", "in", [...ctx.teamUids]);
  }
  const snap = await q.orderBy("updatedAt", "desc").limit(500).get();
  const since = Date.now() - CLOSED_VISIBLE_DAYS * 86_400_000;
  const terms = f.q ? normalizeText(f.q).split(" ").filter(Boolean) : [];
  return snap.docs
    .map((d) => ({ ...(d.data() as Opportunity), id: d.id }))
    .filter((o) => scopeAllows(ctx, o.ownerId))
    .filter((o) => !o.closedAt || o.closedAt >= since)
    .filter((o) => {
      const text = normalizeText(`${o.customerName} ${o.product ?? ""}`);
      return terms.every((t) => text.includes(t));
    });
}

export async function createOpportunity(session: Session, input: CreateInput): Promise<Opportunity> {
  requirePipeline(session, "crear");
  const customer = await getAccessibleCustomer(session, input.customerId);
  const pipeline = await getPipeline(session.orgId);
  const stage = pipeline.stages.find((s) => s.id === (input.stageId ?? pipeline.stages[0].id));
  if (!stage) throw new ApiError(422, "La etapa no existe", [{ path: ["stageId"], message: "Etapa inválida" }]);
  if (stage.kind !== "abierta") throw new ApiError(422, "Una oportunidad nueva arranca en una etapa abierta");
  const ownerId = await resolveOwner(session, input.ownerId, customer.ownerId);

  const ref = col(session.orgId, "opportunities").doc();
  const now = Date.now();
  const opportunity: Opportunity = {
    id: ref.id,
    orgId: session.orgId,
    isDemo: session.org.isDemo,
    customerId: customer.id,
    customerName: customer.name,
    leadId: input.leadId,
    conversationId: input.conversationId,
    ownerId,
    pipelineId: pipeline.id,
    stageId: stage.id,
    estimatedValue: input.estimatedValue,
    product: input.product,
    expectedCloseAt: input.expectedCloseAt ?? undefined,
    probability: input.probability ?? stage.probability,
    nextAction: input.nextAction,
    notes: input.notes,
    stageChangedAt: now,
    createdAt: now,
    createdBy: session.uid,
    updatedAt: now,
    updatedBy: session.uid,
  };
  const leadTo = leadStatusForStage(stage);
  await adminDb().runTransaction(async (tx) => {
    const effects = await readCommercialEffects(tx, session, { leadId: input.leadId, customerId: customer.id, convertProspect: false });
    tx.create(ref, opportunity);
    recordActivityIn(tx, activity(session, opportunity, "oportunidad.creada", `Oportunidad creada en ${stage.name}${input.product ? `: ${input.product}` : ""}`), now);
    effects.write(leadTo ? { to: leadTo } : null, now, { opportunityId: ref.id });
  });
  return opportunity;
}

const EDITABLE = ["ownerId", "estimatedValue", "product", "expectedCloseAt", "probability", "nextAction", "notes"] as const;

export async function updateOpportunity(session: Session, id: string, input: UpdateInput): Promise<Opportunity> {
  const current = await loadOpportunity(session, id, "editar");
  const pipeline = await getPipeline(session.orgId);
  const patch: Partial<Opportunity> = {};
  for (const k of EDITABLE) if (k in input) (patch as Record<string, unknown>)[k] = input[k] ?? undefined;
  if ("ownerId" in input && input.ownerId !== current.ownerId) patch.ownerId = await resolveOwner(session, input.ownerId, null);
  else delete patch.ownerId;

  const from = pipeline.stages.find((s) => s.id === current.stageId);
  const to = input.stageId && input.stageId !== current.stageId ? pipeline.stages.find((s) => s.id === input.stageId) : undefined;
  if (input.stageId && input.stageId !== current.stageId && !to) throw new ApiError(422, "La etapa no existe");
  const now = Date.now();
  if (to) {
    if (to.kind === "perdida" && !input.lostReason) {
      throw new ApiError(422, "Indicá el motivo de la pérdida", [{ path: ["lostReason"], message: "Indicá el motivo" }]);
    }
    patch.stageId = to.id;
    patch.stageChangedAt = now;
    // Al cambiar de etapa se toma la probabilidad de la etapa, salvo que venga explícita.
    if (!("probability" in input)) patch.probability = to.probability;
  }

  const changes = diffFields(current, patch, EDITABLE);
  if (!to && !Object.keys(changes).length) return current;
  const closing = to && to.kind !== "abierta";
  const write: Record<string, unknown> = { updatedAt: now, updatedBy: session.uid };
  for (const [k, v] of Object.entries(patch)) write[k] = v === undefined ? FieldValue.delete() : v;
  if (to) {
    write.closedAt = closing ? now : FieldValue.delete();
    write.lostReason = to.kind === "perdida" ? input.lostReason : FieldValue.delete();
  }

  await adminDb().runTransaction(async (tx) => {
    const fresh = await tx.get(col(session.orgId, "opportunities").doc(id));
    if ((fresh.data() as Opportunity).updatedAt !== current.updatedAt) {
      throw new ApiError(409, "Otra persona modificó esta oportunidad recién. Recargá y volvé a intentar.");
    }
    const leadTo = to ? leadStatusForStage(to) : null;
    const effects = await readCommercialEffects(tx, session, { leadId: current.leadId, customerId: current.customerId, convertProspect: to?.kind === "ganada" });
    tx.update(fresh.ref, write);
    if (to) {
      recordActivityIn(tx, activity(session, current, "oportunidad.etapa", `Oportunidad: ${to.name}${to.kind === "perdida" ? ` — ${input.lostReason}` : ""}`, {
        pipelineStage: { before: from?.name ?? current.stageId, after: to.name },
      }), now);
    }
    if (Object.keys(changes).length) {
      recordActivityIn(tx, activity(session, current, "oportunidad.actualizada", "Oportunidad actualizada", { changes }), now);
    }
    effects.write(leadTo ? { to: leadTo, lostReason: input.lostReason } : null, now, { opportunityId: id });
  });
  return { ...current, ...patch, updatedAt: now } as Opportunity;
}
