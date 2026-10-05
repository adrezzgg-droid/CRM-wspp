import { apiRoute } from "@/server/api/handler";
import { deleteAutomation, updateAutomation } from "@/server/automations/service";
import { automationInput } from "@/lib/schemas";

type P = { id: string };

export const PATCH = apiRoute<typeof automationInput, P>({ body: automationInput }, async ({ session, body, params }) => {
  await updateAutomation(session, params.id, body);
});

export const DELETE = apiRoute<undefined, P>({}, async ({ session, params }) => {
  await deleteAutomation(session, params.id);
});
