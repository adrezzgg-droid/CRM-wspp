import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { adminDb } from "@/server/firebase/admin";
import { serverEnv } from "@/server/env";
import { runSlaCheckAll } from "@/server/inbox/sla-core";
import { runOverdueTasksAll } from "@/server/tasks/overdue-core";

/**
 * Tarea programada: alertas de conversaciones sin respuesta y de tareas
 * vencidas en todas las empresas. La llama el cron (Vercel Cron, Cloud Scheduler, etc.) con
 * `Authorization: Bearer CRON_SECRET`.
 */
function authorized(req: NextRequest): boolean {
  const secret = serverEnv().CRON_SECRET;
  const header = req.headers.get("authorization") ?? "";
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(header);
  return got.length === expected.length && timingSafeEqual(got, expected);
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const [sla, tasks] = await Promise.all([runSlaCheckAll(adminDb()), runOverdueTasksAll(adminDb())]);
  return NextResponse.json({
    ok: true,
    alerted: sla.reduce((n, r) => n + r.alerted, 0),
    overdueTasks: tasks.reduce((n, r) => n + r.notified, 0),
    sla,
    tasks,
  });
}
