/**
 * Alerta de demora: conversaciones que esperan respuesta hace más de
 * `slaMinutes`. Avisa una sola vez por espera al responsable y a quienes lo
 * supervisan (o, si nadie la tiene, a administradores y supervisores).
 *
 * Sin dependencias de Next: la usan la tarea programada, la API y las pruebas.
 */
import type { Firestore } from "firebase-admin/firestore";
import type { AssignmentSettings, Conversation, Member, Notification, Team } from "../../types/model.ts";
import { DEFAULT_ASSIGNMENT_SETTINGS, slaBreached, waitingMinutes } from "../../lib/assignment.ts";

export interface SlaResult {
  orgId: string;
  enabled: boolean;
  checked: number;
  alerted: number;
}

export async function runSlaCheck(db: Firestore, orgId: string, now = Date.now()): Promise<SlaResult> {
  const org = db.collection("organizations").doc(orgId);
  const settings = { ...DEFAULT_ASSIGNMENT_SETTINGS, ...((await org.collection("settings").doc("assignment").get()).data() as Partial<AssignmentSettings> | undefined) };
  if (!settings.slaEnabled) return { orgId, enabled: false, checked: 0, alerted: 0 };

  const threshold = now - settings.slaMinutes * 60_000;
  const snap = await org.collection("conversations").where("awaitingReply", "==", true).where("awaitingSince", "<=", threshold).get();
  const candidates = snap.docs
    .map((d) => ({ ...(d.data() as Conversation), id: d.id }))
    .filter((c) => slaBreached(c, settings.slaMinutes, now));
  if (!candidates.length) return { orgId, enabled: true, checked: snap.size, alerted: 0 };

  const [membersSnap, teamsSnap] = await Promise.all([org.collection("members").where("active", "==", true).get(), org.collection("teams").get()]);
  const members = membersSnap.docs.map((d) => ({ ...(d.data() as Member), id: d.id }));
  const teams = teamsSnap.docs.map((d) => d.data() as Team);
  const byId = new Map(members.map((m) => [m.id, m]));
  const managers = members.filter((m) => m.role === "admin" || m.role === "supervisor");

  /** Supervisores de los equipos del responsable; si no tiene equipo, todos los administradores. */
  function recipientsFor(c: Conversation): Member[] {
    if (!c.assigneeId || !byId.has(c.assigneeId)) return managers;
    const leaders = new Set(teams.filter((t) => t.memberIds.includes(c.assigneeId!) || t.leaderIds.includes(c.assigneeId!)).flatMap((t) => t.leaderIds));
    const supervisors = members.filter((m) => leaders.has(m.id) && m.id !== c.assigneeId);
    const extra = supervisors.length ? supervisors : members.filter((m) => m.role === "admin" && m.id !== c.assigneeId);
    return [byId.get(c.assigneeId)!, ...extra];
  }

  let alerted = 0;
  for (const c of candidates) {
    const ref = org.collection("conversations").doc(c.id);
    const done = await db.runTransaction(async (tx) => {
      const fresh = (await tx.get(ref)).data() as Conversation | undefined;
      if (!fresh || !slaBreached(fresh, settings.slaMinutes, now)) return false;
      const minutes = waitingMinutes(fresh.awaitingSince, now);
      const type = fresh.firstResponseAt ? "cliente_esperando" : "lead_sin_responder";
      const who = fresh.assigneeId ? byId.get(fresh.assigneeId)?.displayName ?? "su responsable" : "nadie (sin asignar)";
      tx.update(ref, { slaAlertedAt: now });
      const act = org.collection("activities").doc();
      tx.create(act, {
        id: act.id,
        orgId,
        isDemo: fresh.isDemo,
        at: now,
        kind: "conversacion.demora",
        customerId: fresh.customerId,
        conversationId: fresh.id,
        leadId: fresh.leadId,
        actorId: "system",
        summary: `Sin respuesta hace ${minutes} min (atiende: ${who})`,
        data: { minutes, assigneeId: fresh.assigneeId },
      });
      for (const m of recipientsFor(fresh)) {
        if (m.notificationPrefs?.[type] === false) continue;
        const nRef = org.collection("notifications").doc();
        const n: Notification = {
          id: nRef.id,
          orgId,
          isDemo: fresh.isDemo,
          userId: m.id,
          type,
          title: `${fresh.contactName} espera respuesta hace ${minutes} min`,
          body: m.id === fresh.assigneeId ? "Respondé lo antes posible." : `Atiende: ${who}`,
          link: `/inbox?c=${fresh.id}`,
          read: false,
          createdAt: now,
        };
        tx.create(nRef, n);
      }
      return true;
    });
    if (done) alerted += 1;
  }
  return { orgId, enabled: true, checked: snap.size, alerted };
}

/** Todas las organizaciones activas (tarea programada). */
export async function runSlaCheckAll(db: Firestore, now = Date.now()): Promise<SlaResult[]> {
  const orgs = await db.collection("organizations").where("status", "==", "active").get();
  const results: SlaResult[] = [];
  for (const o of orgs.docs) results.push(await runSlaCheck(db, o.id, now));
  return results;
}
