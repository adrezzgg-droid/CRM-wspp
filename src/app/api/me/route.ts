import { apiRoute } from "@/server/api/handler";
import { visibleResources } from "@/server/permissions/matrix";

/** Datos del usuario actual y los recursos que puede ver. */
export const GET = apiRoute({}, async ({ session }) => ({
  uid: session.uid,
  email: session.email,
  displayName: session.member.displayName,
  role: session.role,
  org: session.org,
  resources: visibleResources(session.role, session.overrides),
}));
