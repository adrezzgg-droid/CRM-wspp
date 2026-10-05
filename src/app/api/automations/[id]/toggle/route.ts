import { apiRoute } from "@/server/api/handler";
import { toggleAutomation } from "@/server/automations/service";
import { automationToggleInput } from "@/lib/schemas";

export const POST = apiRoute<typeof automationToggleInput, { id: string }>({ body: automationToggleInput }, async ({ session, body, params }) => {
  await toggleAutomation(session, params.id, body.enabled);
});
