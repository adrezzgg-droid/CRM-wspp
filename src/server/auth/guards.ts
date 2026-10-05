import "server-only";
import { redirect } from "next/navigation";
import { can, type Action, type Resource } from "@/server/permissions/matrix";
import { getSession, type Session } from "./session";

/** Para páginas: sin sesión válida, al login. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

/** Para páginas: sin permiso sobre el recurso, a la pantalla de acceso denegado. */
export async function requireAccess(resource: Resource, action: Action = "ver"): Promise<Session> {
  const session = await requireSession();
  if (!can(session.role, resource, action, session.overrides)) redirect("/sin-acceso");
  return session;
}
