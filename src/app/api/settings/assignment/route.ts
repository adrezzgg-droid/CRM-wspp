import { apiRoute } from "@/server/api/handler";
import { saveAssignmentSettings } from "@/server/org/assignment";
import { assignmentSettingsInput } from "@/lib/schemas";

export const PUT = apiRoute({ body: assignmentSettingsInput }, async ({ session, body }) => {
  await saveAssignmentSettings(session, body);
});
