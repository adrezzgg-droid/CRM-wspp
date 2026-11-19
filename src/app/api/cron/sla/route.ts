import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { adminDb } from "@/server/firebase/admin";
import { serverEnv } from "@/server/env";
import { runSlaCheckAll } from "@/server/inbox/sla-core";
import { runOverdueTasksAll } from "@/server/tasks/overdue-core";
import { runScheduledForAll } from "@/server/automations/run";
import { webhookDeps } from "@/server/whatsapp/deps";
import { retryWebhookEvents } from "@/server/whatsapp/webhook-core";
import { processOutboxAll } from "@/server/connectors/outbox-core";
import { outboxDeps } from "@/server/connectors/service";

/**
 * Tarea programada: alertas de demora, tareas vencidas, automatizaciones
 * por tiempo (y las agendadas), reintentos de webhooks de WhatsApp y la cola de
 * envíos a otros sistemas (conectores), en todas las empresas. La llama el cron (Vercel Cron, Cloud Scheduler, etc.) con
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
  const [sla, tasks, automations, webhooks, outbox] = await Promise.all([
    runSlaCheckAll(adminDb()),
    runOverdueTasksAll(adminDb()),
    runScheduledForAll(),
    retryWebhookEvents(webhookDeps()),
    processOutboxAll(outboxDeps()),
  ]);
  return NextResponse.json({
    ok: true,
    alerted: sla.reduce((n, r) => n + r.alerted, 0),
    overdueTasks: tasks.reduce((n, r) => n + r.notified, 0),
    sla,
    tasks,
    automations,
    webhooks,
    outbox,
  });
}
