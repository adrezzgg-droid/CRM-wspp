import { apiRoute } from "@/server/api/handler";
import { saveGeneralSettings } from "@/server/org/settings";
import { generalSettingsInput } from "@/lib/schemas";

export const PUT = apiRoute({ body: generalSettingsInput }, async ({ session, body }) => {
  await saveGeneralSettings(session, body);
});
