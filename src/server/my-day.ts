import "server-only";
import type { QuerySnapshot } from "firebase-admin/firestore";
import type { Conversation, Customer, Opportunity, Order, Task } from "@/types/model";
import { orgPath } from "@/types/model";
import { adminDb } from "@/server/firebase/admin";
import { can } from "@/server/permissions/matrix";
import type { Session } from "@/server/auth/session";
import { listTasks } from "@/server/tasks/service";
import { listOpportunities } from "@/server/commercial/opportunities";
import { getPipeline } from "@/server/commercial/common";
import { OPEN_STATUSES } from "@/lib/inbox-filters";
import { dayBounds } from "@/lib/tasks";

export interface MyDay {
  /** Momento de la consulta (para calcular demoras y saludos). */
  now: number;
  newLeads: Conversation[] | null;
  unanswered: Conversation[] | null;
  overdueTasks: Task[] | null;
  todayTasks: Task[] | null;
  toFollow: Customer[] | null;
  opportunities: Opportunity[] | null;
  orders: Order[] | null;
}

const col = (orgId: string, c: Parameters<typeof orgPath>[1]) => adminDb().collection(orgPath(orgId, c));
const rows = <T,>(snap: QuerySnapshot) => snap.docs.map((d) => ({ ...(d.data() as T), id: d.id }));

/**
 * "¿Qué tengo que hacer hoy?": todo lo PERSONAL del usuario (aunque su rol
 * vea más). Cada bloque es null si el rol no tiene ese módulo.
 */
export async function getMyDay(session: Session): Promise<MyDay> {
  const sees = (r: Parameters<typeof can>[1]) => can(session.role, r, "ver", session.overrides);
  const now = Date.now();
  const { start } = dayBounds(now, session.org.timezone);
  const isDriver = session.role === "repartidor";

  const [conversations, overdueTasks, todayTasks, toFollow, opportunities, orders] = await Promise.all([
    sees("inbox") && !isDriver
      ? col(session.orgId, "conversations").where("assigneeId", "==", session.uid).where("status", "in", OPEN_STATUSES).orderBy("lastMessageAt", "desc").limit(100).get().then((s) => rows<Conversation>(s))
      : null,
    sees("tareas") ? listTasks(session, { vista: "vencidas", responsable: session.uid }) : null,
    sees("tareas") ? listTasks(session, { vista: "hoy", responsable: session.uid }) : null,
    sees("clientes") && !isDriver
      ? col(session.orgId, "customers").where("archived", "==", false).where("ownerId", "==", session.uid).where("needsReactivation", "==", true).orderBy("updatedAt", "desc").limit(8).get().then((s) => rows<Customer>(s))
      : null,
    sees("pipeline") ? listOpportunities(session, { owner: session.uid }) : null,
    sees("pedidos")
      ? (isDriver
          ? col(session.orgId, "orders").where("driverId", "==", session.uid).where("status", "in", ["confirmado", "en_preparacion", "en_reparto"]).orderBy("createdAt", "desc").limit(50)
          : col(session.orgId, "orders").where("sellerId", "==", session.uid).where("createdAt", ">=", start).orderBy("createdAt", "desc").limit(50)
        )
          .get()
          .then((s) => rows<Order>(s))
      : null,
  ]);

  let openOpps: Opportunity[] | null = null;
  if (opportunities) {
    const stages = new Map((await getPipeline(session.orgId)).stages.map((s) => [s.id, s]));
    openOpps = opportunities
      .filter((o) => stages.get(o.stageId)?.kind === "abierta")
      .sort((a, b) => (a.expectedCloseAt ?? Infinity) - (b.expectedCloseAt ?? Infinity) || b.estimatedValue - a.estimatedValue)
      .slice(0, 6);
  }

  return {
    now,
    newLeads: conversations ? conversations.filter((c) => c.customerStage === "prospecto" && !c.firstResponseAt) : null,
    unanswered: conversations ? conversations.filter((c) => c.awaitingReply) : null,
    overdueTasks,
    todayTasks,
    toFollow,
    opportunities: openOpps,
    orders,
  };
}
