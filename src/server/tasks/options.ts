import "server-only";
import { can } from "@/server/permissions/matrix";
import { scopeAllows } from "@/server/permissions/scope";
import type { Session } from "@/server/auth/session";
import { getMembers, scopeContext } from "@/server/org/data";
import { msToZoned } from "@/lib/tasks";
import type { TaskFormOptions } from "@/components/tasks/task-form";

/** Opciones del formulario de tareas, recortadas a lo que el usuario puede hacer. */
export async function taskFormOptions(session: Session): Promise<TaskFormOptions> {
  const canAssign = can(session.role, "tareas", "asignar", session.overrides);
  const ctx = canAssign ? await scopeContext(session, "tareas") : null;
  const members = canAssign ? await getMembers(session.orgId) : [];
  return {
    timezone: session.org.timezone,
    today: msToZoned(Date.now(), session.org.timezone).date,
    assignees: ctx
      ? members
          .filter((m) => m.active && m.role !== "solo_lectura" && scopeAllows(ctx, m.id))
          .sort((a, b) => a.displayName.localeCompare(b.displayName, "es"))
          .map((m) => ({ id: m.id, name: m.id === session.uid ? `${m.displayName} (yo)` : m.displayName }))
      : [],
    canPickCustomer: can(session.role, "clientes", "ver", session.overrides),
  };
}
