import "server-only";
import { FieldValue, type Query, type WriteBatch } from "firebase-admin/firestore";
import type { z } from "zod";
import type { Notification, Task } from "@/types/model";
import { TASK_TYPE_LABELS, orgPath } from "@/types/model";
import { adminDb } from "@/server/firebase/admin";
import { ApiError } from "@/server/api/handler";
import { recordActivityIn, type ActivityEntry } from "@/server/audit";
import { can, type Action } from "@/server/permissions/matrix";
import { scopeAllows } from "@/server/permissions/scope";
import type { Session } from "@/server/auth/session";
import { getMembers, scopeContext } from "@/server/org/data";
import { getAccessibleCustomer } from "@/server/customers/service";
import { dayBounds, msToZoned, zonedTimeToMs, type TaskView } from "@/lib/tasks";
import type { taskInput, taskStatusInput, taskUpdate } from "@/lib/schemas";

const col = (orgId: string) => adminDb().collection(orgPath(orgId, "tasks"));
const PAGE = 100;

function requireTasks(session: Session, action: Action) {
  if (!can(session.role, "tareas", action, session.overrides)) throw new ApiError(403, "No tenés permiso para esta acción sobre tareas");
}

function activity(session: Session, t: Pick<Task, "id" | "customerId" | "conversationId">, kind: string, summary: string, data?: Record<string, unknown>): ActivityEntry {
  return { orgId: session.orgId, isDemo: session.org.isDemo, customerId: t.customerId, conversationId: t.conversationId, kind, summary, actorId: session.uid, data: { taskId: t.id, ...data } };
}

export async function loadTask(session: Session, id: string, action: Action = "ver"): Promise<Task> {
  requireTasks(session, action);
  const snap = await col(session.orgId).doc(id).get();
  if (!snap.exists) throw new ApiError(404, "Tarea no encontrada");
  const task = { ...(snap.data() as Task), id: snap.id };
  if (!scopeAllows(await scopeContext(session, "tareas"), task.assigneeId)) throw new ApiError(404, "Tarea no encontrada");
  return task;
}

/** Quien no puede asignar, solo se crea tareas a sí mismo. */
async function resolveAssignee(session: Session, requested?: string): Promise<string> {
  if (!requested || requested === session.uid) return session.uid;
  if (!can(session.role, "tareas", "asignar", session.overrides)) throw new ApiError(403, "No podés asignar tareas a otros usuarios");
  const member = (await getMembers(session.orgId)).find((m) => m.id === requested);
  if (!member?.active || member.role === "solo_lectura") throw new ApiError(422, "El responsable no es un usuario activo", [{ path: ["assigneeId"], message: "Responsable inválido" }]);
  if (!scopeAllows(await scopeContext(session, "tareas"), requested)) throw new ApiError(403, "Solo podés asignar tareas dentro de tu equipo");
  return requested;
}

// ──────────────────────────────── Lectura ──────────────────────────────────

function scopedQuery(session: Session, ctx: Awaited<ReturnType<typeof scopeContext>>, responsable?: string): Query | null {
  let q: Query = col(session.orgId);
  if (responsable) {
    if (!scopeAllows(ctx, responsable)) return null;
    return q.where("assigneeId", "==", responsable);
  }
  if (ctx.scope === "propio") q = q.where("assigneeId", "==", session.uid);
  else if (ctx.scope === "equipo") q = q.where("assigneeId", "in", [...ctx.teamUids].slice(0, 30));
  return q;
}

function viewQuery(base: Query, view: TaskView, bounds: { start: number; end: number }): Query {
  switch (view) {
    case "hoy":
      return base.where("status", "==", "pendiente").where("dueAt", ">=", bounds.start).where("dueAt", "<=", bounds.end).orderBy("dueAt");
    case "vencidas":
      return base.where("status", "==", "pendiente").where("dueAt", "<", bounds.start).orderBy("dueAt");
    case "proximas":
      return base.where("status", "==", "pendiente").where("dueAt", ">", bounds.end).orderBy("dueAt");
    case "completadas":
      return base.where("status", "==", "completada").orderBy("completedAt", "desc");
  }
}

export async function listTasks(session: Session, f: { vista: TaskView; responsable?: string }): Promise<Task[]> {
  requireTasks(session, "ver");
  const base = scopedQuery(session, await scopeContext(session, "tareas"), f.responsable);
  if (!base) return [];
  const snap = await viewQuery(base, f.vista, dayBounds(Date.now(), session.org.timezone)).limit(PAGE).get();
  return snap.docs.map((d) => ({ ...(d.data() as Task), id: d.id }));
}

/** Cantidad de tareas pendientes por vista (para las pestañas y Mi día). */
export async function taskCounts(session: Session, responsable?: string): Promise<Record<Exclude<TaskView, "completadas">, number>> {
  requireTasks(session, "ver");
  const base = scopedQuery(session, await scopeContext(session, "tareas"), responsable);
  if (!base) return { hoy: 0, vencidas: 0, proximas: 0 };
  const bounds = dayBounds(Date.now(), session.org.timezone);
  const [hoy, vencidas, proximas] = await Promise.all(
    (["hoy", "vencidas", "proximas"] as const).map((v) => viewQuery(base, v, bounds).count().get().then((r) => r.data().count)),
  );
  return { hoy, vencidas, proximas };
}

// ──────────────────────────────── Escritura ────────────────────────────────

function notifyAssignee(batch: WriteBatch, session: Session, task: Task, now: number) {
  const ref = adminDb().collection(orgPath(session.orgId, "notifications")).doc();
  const n: Notification = {
    id: ref.id,
    orgId: session.orgId,
    isDemo: session.org.isDemo,
    userId: task.assigneeId,
    type: "nueva_asignacion",
    title: `${session.member.displayName} te asignó una tarea: ${TASK_TYPE_LABELS[task.type]}${task.customerName ? ` con ${task.customerName}` : ""}`,
    body: task.description,
    link: "/tareas",
    read: false,
    createdAt: now,
  };
  batch.create(ref, n);
}

export async function createTask(session: Session, input: z.output<typeof taskInput>): Promise<Task> {
  requireTasks(session, "crear");
  const assigneeId = await resolveAssignee(session, input.assigneeId);
  const customer = input.customerId ? await getAccessibleCustomer(session, input.customerId) : null;
  const ref = col(session.orgId).doc();
  const now = Date.now();
  const task: Task = {
    id: ref.id,
    orgId: session.orgId,
    isDemo: session.org.isDemo,
    customerId: customer?.id,
    customerName: customer?.name,
    conversationId: input.conversationId,
    opportunityId: input.opportunityId,
    assigneeId,
    type: input.type,
    priority: input.priority,
    status: "pendiente",
    dueAt: zonedTimeToMs(input.dueDate, input.dueTime, session.org.timezone),
    description: input.description,
    createdAt: now,
    createdBy: session.uid,
    updatedAt: now,
    updatedBy: session.uid,
  };
  const batch = adminDb().batch();
  batch.create(ref, task);
  if (customer) {
    recordActivityIn(batch, activity(session, task, "tarea.creada", `Tarea programada: ${TASK_TYPE_LABELS[task.type]} el ${input.dueDate.split("-").reverse().join("/")} ${input.dueTime}${task.description ? ` — ${task.description}` : ""}`), now);
  }
  const assignee = (await getMembers(session.orgId)).find((m) => m.id === assigneeId);
  if (assigneeId !== session.uid && assignee?.notificationPrefs?.nueva_asignacion !== false) notifyAssignee(batch, session, task, now);
  await batch.commit();
  return task;
}

export async function updateTask(session: Session, id: string, input: z.output<typeof taskUpdate>): Promise<Task> {
  const current = await loadTask(session, id, "editar");
  if (current.status !== "pendiente") throw new ApiError(409, "Solo se editan tareas pendientes. Reabrila primero.");
  const patch: Record<string, unknown> = {};
  if (input.type) patch.type = input.type;
  if (input.priority) patch.priority = input.priority;
  if ("description" in input) patch.description = input.description ?? FieldValue.delete();
  if (input.assigneeId && input.assigneeId !== current.assigneeId) patch.assigneeId = await resolveAssignee(session, input.assigneeId);
  if ("customerId" in input && input.customerId !== (current.customerId ?? null)) {
    if (input.customerId) {
      const c = await getAccessibleCustomer(session, input.customerId);
      patch.customerId = c.id;
      patch.customerName = c.name;
    } else {
      patch.customerId = FieldValue.delete();
      patch.customerName = FieldValue.delete();
    }
  }
  if (input.dueDate || input.dueTime) {
    const local = msToZoned(current.dueAt, session.org.timezone);
    const dueAt = zonedTimeToMs(input.dueDate ?? local.date, input.dueTime ?? local.time, session.org.timezone);
    if (dueAt !== current.dueAt) {
      patch.dueAt = dueAt;
      // Reprogramada: si vuelve a vencer, se vuelve a avisar.
      patch.overdueNotifiedAt = FieldValue.delete();
    }
  }
  if (!Object.keys(patch).length) return current;
  const now = Date.now();
  const batch = adminDb().batch();
  batch.update(col(session.orgId).doc(id), { ...patch, updatedAt: now, updatedBy: session.uid });
  const next = { ...current, ...(patch.assigneeId ? { assigneeId: patch.assigneeId as string } : {}) };
  if (patch.dueAt && current.customerId) {
    recordActivityIn(batch, activity(session, current, "tarea.reprogramada", `Tarea reprogramada: ${TASK_TYPE_LABELS[(patch.type as Task["type"]) ?? current.type]}`), now);
  }
  if (patch.assigneeId && patch.assigneeId !== session.uid) {
    const assignee = (await getMembers(session.orgId)).find((m) => m.id === patch.assigneeId);
    if (assignee?.notificationPrefs?.nueva_asignacion !== false) notifyAssignee(batch, session, next as Task, now);
  }
  await batch.commit();
  return { ...current, ...(Object.fromEntries(Object.entries(patch).filter(([, v]) => !(v instanceof FieldValue))) as Partial<Task>), updatedAt: now };
}

/** Completar (con resultado), cancelar o reabrir. El resultado queda en el historial del cliente. */
export async function setTaskStatus(session: Session, id: string, input: z.output<typeof taskStatusInput>): Promise<Task> {
  const current = await loadTask(session, id, "editar");
  if (current.status === input.status) return current;
  const now = Date.now();
  const patch: Record<string, unknown> = { status: input.status, updatedAt: now, updatedBy: session.uid };
  if (input.status === "completada") {
    patch.completedAt = now;
    if (input.outcome) patch.outcome = input.outcome;
  } else if (input.status === "cancelada") {
    patch.cancelledAt = now;
  } else {
    patch.completedAt = FieldValue.delete();
    patch.cancelledAt = FieldValue.delete();
  }
  const batch = adminDb().batch();
  batch.update(col(session.orgId).doc(id), patch);
  if (current.customerId) {
    const label = TASK_TYPE_LABELS[current.type];
    const summary =
      input.status === "completada"
        ? `${label} realizada${input.outcome ? `: ${input.outcome}` : ""}`
        : input.status === "cancelada"
          ? `${label} cancelada`
          : `${label} reabierta`;
    recordActivityIn(batch, activity(session, current, `tarea.${input.status}`, summary, { taskType: current.type }), now);
  }
  await batch.commit();
  return { ...current, status: input.status, outcome: input.outcome ?? current.outcome, completedAt: input.status === "completada" ? now : undefined };
}
