import { apiRoute } from "@/server/api/handler";
import { savePermissions } from "@/server/org/settings";
import { permissionsInput } from "@/lib/schemas";

export const PUT = apiRoute({ body: permissionsInput }, async ({ session, body }) => {
  await savePermissions(session, body);
});
