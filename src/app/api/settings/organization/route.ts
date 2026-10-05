import { apiRoute } from "@/server/api/handler";
import { updateOrganization } from "@/server/org/settings";
import { organizationUpdate } from "@/lib/schemas";

export const PATCH = apiRoute({ body: organizationUpdate }, async ({ session, body }) => {
  await updateOrganization(session, body);
});
