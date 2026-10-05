import "server-only";
import { cache } from "react";
import { FieldValue, type WriteBatch } from "firebase-admin/firestore";
import type { z } from "zod";
import type { AssignmentSettings, Customer, Member, Zone } from "@/types/model";
import { orgPath } from "@/types/model";
import { adminDb } from "@/server/firebase/admin";
import { ApiError } from "@/server/api/handler";
import { recordAuditIn } from "@/server/audit";
import { can } from "@/server/permissions/matrix";
import type { Session } from "@/server/auth/session";
import { DEFAULT_ASSIGNMENT_SETTINGS } from "@/lib/assignment";
import type { assignmentSettingsInput, zoneInput } from "@/lib/schemas";
import { runSlaCheck, type SlaResult } from "@/server/inbox/sla-core";
import { runOverdueTasks } from "@/server/tasks/overdue-core";
import { getMembers, getZones, OWNER_ROLES } from "./data";

const col = (orgId: string, c: Parameters<typeof orgPath>[1]) => adminDb().collection(orgPath(orgId, c));

function requireConfig(session: Session) {
  if (!can(session.role, "configuracion", "editar", session.overrides)) {
    throw new ApiError(403, "No tenés permiso para cambiar la configuración");
  }
}

function audit(session: Session, action: string, target: { collection: string; id: string }, before?: unknown, after?: unknown) {
  return { orgId: session.orgId, isDemo: session.org.isDemo, actorId: session.uid, action, target, before, after };
}

// ───────────────────────────── Reglas ───────────────────────────────────────

export const getAssignmentSettings = cache(async (orgId: string) => {
  const snap = await col(orgId, "settings").doc("assignment").get();
  return { ...DEFAULT_ASSIGNMENT_SETTINGS, ...(snap.data() as Partial<AssignmentSettings> | undefined) };
});

export async function saveAssignmentSettings(session: Session, input: z.output<typeof assignmentSettingsInput>) {
  requireConfig(session);
  const before = await getAssignmentSettings(session.orgId);
  const now = Date.now();
  const batch = adminDb().batch();
  batch.set(col(session.orgId, "settings").doc("assignment"), { ...input, updatedAt: now, updatedBy: session.uid });
  recordAuditIn(batch, audit(session, "settings.assignment_updated", { collection: "settings", id: "assignment" }, before, input), now);
  await batch.commit();
}

/** Revisión a pedido de demoras y tareas vencidas (lo mismo que la tarea programada). */
export async function runSlaNow(session: Session): Promise<SlaResult & { overdueTasks: number }> {
  if (!can(session.role, "inbox", "asignar", session.overrides)) throw new ApiError(403, "No tenés permiso para esta acción");
  const [sla, tasks] = await Promise.all([runSlaCheck(adminDb(), session.orgId), runOverdueTasks(adminDb(), session.orgId)]);
  return { ...sla, overdueTasks: tasks.notified };
}

// ───────────────────────────── Zonas ────────────────────────────────────────

async function assertSellers(session: Session, ids: string[]): Promise<Member[]> {
  const members = await getMembers(session.orgId);
  for (const id of ids) {
    const m = members.find((x) => x.id === id);
    if (!m?.active || !OWNER_ROLES.has(m.role)) {
      throw new ApiError(422, "Hay vendedores inexistentes o dados de baja", [{ path: ["sellerIds"], message: "Vendedor inválido" }]);
    }
  }
  return members;
}

/** Ajusta `member.zoneIds` para que exactamente `sellerIds` cubran la zona. */
function syncSellers(batch: WriteBatch, orgId: string, zoneId: string, members: Member[], sellerIds: string[]) {
  for (const m of members) {
    const has = (m.zoneIds ?? []).includes(zoneId);
    const wants = sellerIds.includes(m.id);
    if (has && !wants) batch.update(col(orgId, "members").doc(m.id), { zoneIds: FieldValue.arrayRemove(zoneId) });
    if (!has && wants) batch.update(col(orgId, "members").doc(m.id), { zoneIds: FieldValue.arrayUnion(zoneId) });
  }
}

async function assertUniqueZone(session: Session, name: string, exceptId?: string) {
  const clash = (await getZones(session.orgId)).find((z) => z.name.toLowerCase() === name.toLowerCase() && z.id !== exceptId);
  if (clash) throw new ApiError(409, "Ya existe una zona con ese nombre", [{ path: ["name"], message: "Nombre repetido" }]);
}

export async function createZone(session: Session, input: z.output<typeof zoneInput>): Promise<Zone> {
  requireConfig(session);
  await assertUniqueZone(session, input.name);
  const members = await assertSellers(session, input.sellerIds);
  const ref = col(session.orgId, "zones").doc();
  const now = Date.now();
  const zone: Zone = {
    id: ref.id,
    orgId: session.orgId,
    isDemo: session.org.isDemo,
    name: input.name,
    localities: [...new Set(input.localities)],
    createdAt: now,
    createdBy: session.uid,
    updatedAt: now,
    updatedBy: session.uid,
  };
  const batch = adminDb().batch();
  batch.create(ref, zone);
  syncSellers(batch, session.orgId, ref.id, members, input.sellerIds);
  recordAuditIn(batch, audit(session, "zone.created", { collection: "zones", id: ref.id }, undefined, input), now);
  await batch.commit();
  return zone;
}

export async function updateZone(session: Session, id: string, input: z.output<typeof zoneInput>) {
  requireConfig(session);
  const current = (await getZones(session.orgId)).find((z) => z.id === id);
  if (!current) throw new ApiError(404, "Zona no encontrada");
  await assertUniqueZone(session, input.name, id);
  const members = await assertSellers(session, input.sellerIds);
  const now = Date.now();
  const batch = adminDb().batch();
  batch.update(col(session.orgId, "zones").doc(id), { name: input.name, localities: [...new Set(input.localities)], updatedAt: now, updatedBy: session.uid });
  syncSellers(batch, session.orgId, id, members, input.sellerIds);
  const before = { name: current.name, localities: current.localities, sellerIds: members.filter((m) => m.zoneIds?.includes(id)).map((m) => m.id) };
  recordAuditIn(batch, audit(session, "zone.updated", { collection: "zones", id }, before, input), now);
  await batch.commit();
}

/** Solo se borra una zona sin clientes: si no, se perdería a quién atiende cada uno. */
export async function deleteZone(session: Session, id: string) {
  requireConfig(session);
  const current = (await getZones(session.orgId)).find((z) => z.id === id);
  if (!current) throw new ApiError(404, "Zona no encontrada");
  const used = await col(session.orgId, "customers").where("zoneId", "==", id).limit(1).get();
  if (!used.empty) {
    const name = (used.docs[0].data() as Customer).name;
    throw new ApiError(409, `La zona tiene clientes (por ejemplo, ${name}). Cambiales la zona antes de borrarla.`);
  }
  const members = await getMembers(session.orgId);
  const batch = adminDb().batch();
  batch.delete(col(session.orgId, "zones").doc(id));
  syncSellers(batch, session.orgId, id, members, []);
  recordAuditIn(batch, audit(session, "zone.deleted", { collection: "zones", id }, { name: current.name, localities: current.localities }));
  await batch.commit();
}
