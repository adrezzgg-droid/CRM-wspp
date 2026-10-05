import "server-only";
import type { DocumentReference, Transaction, WriteBatch } from "firebase-admin/firestore";
import type { Activity, AuditLog } from "@/types/model";
import { orgPath } from "@/types/model";
import { adminDb } from "./firebase/admin";

/**
 * Historial de solo inserción. Nunca se actualiza ni se borra un registro:
 * cada cambio importante agrega uno nuevo (reglas: write: if false).
 *
 * Las variantes `...In(tx|batch, ...)` escriben el historial en la MISMA
 * operación atómica que el cambio: o se guardan los dos o ninguno.
 */

type Writer = Transaction | WriteBatch;

export type ActivityEntry = Omit<Activity, "id" | "at">;
export type AuditEntry = Omit<AuditLog, "id" | "at">;

function newRef(orgId: string, collection: "activities" | "auditLogs"): DocumentReference {
  return adminDb().collection(orgPath(orgId, collection)).doc();
}

export function recordActivityIn(w: Writer, entry: ActivityEntry, at = Date.now()): void {
  const ref = newRef(entry.orgId, "activities");
  w.create(ref, { ...entry, id: ref.id, at });
}

export function recordAuditIn(w: Writer, entry: AuditEntry, at = Date.now()): void {
  const ref = newRef(entry.orgId, "auditLogs");
  w.create(ref, { ...entry, id: ref.id, at });
}

export async function recordAudit(entry: AuditEntry): Promise<void> {
  const batch = adminDb().batch();
  recordAuditIn(batch, entry);
  await batch.commit();
}

export async function recordActivity(entry: ActivityEntry): Promise<void> {
  const batch = adminDb().batch();
  recordActivityIn(batch, entry);
  await batch.commit();
}
