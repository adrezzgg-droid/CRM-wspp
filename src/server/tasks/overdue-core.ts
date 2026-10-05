/**
 * Aviso de tareas vencidas: una sola notificación por tarea (o por cada vez
 * que se reprograma y vuelve a vencer). Sin dependencias de Next: la usan la
 * tarea programada y las pruebas.
 */
import type { Firestore } from "firebase-admin/firestore";
import type { Member, Notification, Task } from "../../types/model.ts";
import { TASK_TYPE_LABELS } from "../../types/model.ts";

export interface OverdueResult {
  orgId: string;
  notified: number;
}

export async function runOverdueTasks(db: Firestore, orgId: string, now = Date.now()): Promise<OverdueResult> {
  const org = db.collection("organizations").doc(orgId);
  const snap = await org.collection("tasks").where("status", "==", "pendiente").where("dueAt", "<=", now).orderBy("dueAt").limit(500).get();
  const due = snap.docs.filter((d) => !(d.data() as Task).overdueNotifiedAt);
  if (!due.length) return { orgId, notified: 0 };

  const members = new Map((await org.collection("members").where("active", "==", true).get()).docs.map((d) => [d.id, d.data() as Member]));
  let notified = 0;
  for (let i = 0; i < due.length; i += 200) {
    const batch = db.batch();
    for (const d of due.slice(i, i + 200)) {
      const t = d.data() as Task;
      batch.update(d.ref, { overdueNotifiedAt: now });
      const member = members.get(t.assigneeId);
      if (!member || member.notificationPrefs?.tarea_vencida === false) continue;
      const ref = org.collection("notifications").doc();
      const n: Notification = {
        id: ref.id,
        orgId,
        isDemo: t.isDemo,
        userId: t.assigneeId,
        type: "tarea_vencida",
        title: `Tarea vencida: ${TASK_TYPE_LABELS[t.type]}${t.customerName ? ` con ${t.customerName}` : ""}`,
        body: t.description,
        link: "/tareas?vista=vencidas",
        read: false,
        createdAt: now,
      };
      batch.create(ref, n);
      notified += 1;
    }
    await batch.commit();
  }
  return { orgId, notified };
}

export async function runOverdueTasksAll(db: Firestore, now = Date.now()): Promise<OverdueResult[]> {
  const orgs = await db.collection("organizations").where("status", "==", "active").get();
  const out: OverdueResult[] = [];
  for (const o of orgs.docs) out.push(await runOverdueTasks(db, o.id, now));
  return out;
}
