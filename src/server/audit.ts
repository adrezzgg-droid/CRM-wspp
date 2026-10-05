import "server-only";
import type { Activity, AuditLog } from "@/types/model";
import { orgPath } from "@/types/model";
import { adminDb } from "./firebase/admin";

/**
 * Historial de solo inserción. Nunca se actualiza ni se borra un registro:
 * cada cambio importante agrega uno nuevo (reglas: write: if false).
 */

export async function recordAudit(entry: Omit<AuditLog, "id" | "at">): Promise<void> {
  const ref = adminDb().collection(orgPath(entry.orgId, "auditLogs")).doc();
  await ref.create({ ...entry, id: ref.id, at: Date.now() });
}

export async function recordActivity(entry: Omit<Activity, "id" | "at">): Promise<void> {
  const ref = adminDb().collection(orgPath(entry.orgId, "activities")).doc();
  await ref.create({ ...entry, id: ref.id, at: Date.now() });
}
