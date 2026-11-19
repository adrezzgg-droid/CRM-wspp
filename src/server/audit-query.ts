import "server-only";
import type { Query } from "firebase-admin/firestore";
import type { AuditLog } from "@/types/model";
import { orgPath } from "@/types/model";
import { adminDb } from "@/server/firebase/admin";
import { ApiError } from "@/server/api/handler";
import { can } from "@/server/permissions/matrix";
import type { Session } from "@/server/auth/session";
import { getMembers } from "@/server/org/data";
import { recordAudit } from "@/server/audit";
import { addDays } from "@/lib/metrics";
import { zonedTimeToMs } from "@/lib/tasks";
import { actionsOf, auditChanges, auditLabel, toCsv } from "@/lib/audit-labels";
import type { AuditQuery } from "@/lib/schemas";

export const AUDIT_PAGE_SIZE = 50;
const EXPORT_MAX = 5000;

function auditQueryFor(session: Session, q: AuditQuery): Query {
  if (!can(session.role, "auditoria", "ver", session.overrides)) throw new ApiError(403, "No tenés permiso para ver la auditoría");
  if (q.desde && q.hasta && q.desde > q.hasta) throw new ApiError(422, "La fecha de inicio tiene que ser anterior a la de fin");
  const tz = session.org.timezone;
  let query: Query = adminDb().collection(orgPath(session.orgId, "auditLogs"));
  if (q.usuario) query = query.where("actorId", "==", q.usuario);
  if (q.categoria) query = query.where("action", "in", actionsOf(q.categoria));
  if (q.desde) query = query.where("at", ">=", zonedTimeToMs(q.desde, "00:00", tz));
  if (q.hasta) query = query.where("at", "<", zonedTimeToMs(addDays(q.hasta, 1), "00:00", tz));
  return query.orderBy("at", "desc");
}

export async function listAuditLogs(session: Session, q: AuditQuery): Promise<{ items: AuditLog[]; nextCursor: string | null }> {
  let query = auditQueryFor(session, q);
  if (q.cursor) {
    const c = await adminDb().collection(orgPath(session.orgId, "auditLogs")).doc(q.cursor).get();
    if (c.exists) query = query.startAfter(c);
  }
  const snap = await query.limit(AUDIT_PAGE_SIZE).get();
  return {
    items: snap.docs.map((d) => ({ ...(d.data() as AuditLog), id: d.id })),
    nextCursor: snap.size === AUDIT_PAGE_SIZE ? snap.docs.at(-1)!.id : null,
  };
}

/** Exportación con los mismos filtros (hasta 5.000 registros), una fila por registro. */
export async function exportAuditCsv(session: Session, q: AuditQuery): Promise<{ csv: string; truncated: boolean }> {
  const snap = await auditQueryFor(session, q).limit(EXPORT_MAX + 1).get();
  const names = new Map((await getMembers(session.orgId)).map((m) => [m.id, `${m.displayName} <${m.email}>`]));
  const when = new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "medium", timeZone: session.org.timezone });
  const rows: (string | number)[][] = [["Fecha", "Usuario", "Acción", "Código", "Objeto", "Cambios", "IP"]];
  for (const d of snap.docs.slice(0, EXPORT_MAX)) {
    const a = d.data() as AuditLog;
    rows.push([
      when.format(a.at),
      a.actorId === "system" ? "Sistema" : (names.get(a.actorId) ?? a.actorId),
      auditLabel(a.action),
      a.action,
      `${a.target.collection}/${a.target.id}`,
      auditChanges(a.before, a.after).map((c) => `${c.field}: ${c.before} → ${c.after}`).join(" | "),
      a.ip ?? "",
    ]);
  }
  // Exportar también queda registrado (es una lectura masiva de datos sensibles).
  await recordAudit({
    orgId: session.orgId,
    isDemo: session.org.isDemo,
    actorId: session.uid,
    action: "audit.exported",
    target: { collection: "auditLogs", id: "*" },
    after: { filtros: q, filas: rows.length - 1 },
  });
  return { csv: toCsv(rows), truncated: snap.size > EXPORT_MAX };
}
