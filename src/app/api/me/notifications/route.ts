import { apiRoute } from "@/server/api/handler";
import { setOwnNotificationPrefs } from "@/server/members/service";
import { notificationPrefsInput } from "@/lib/schemas";

export const PUT = apiRoute({ body: notificationPrefsInput }, async ({ session, body }) => {
  await setOwnNotificationPrefs(session, body.prefs);
});
