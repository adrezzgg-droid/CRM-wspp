import { apiRoute } from "@/server/api/handler";
import { deleteTemplate, updateTemplate } from "@/server/automations/service";
import { templateInput } from "@/lib/schemas";

type P = { id: string };

export const PATCH = apiRoute<typeof templateInput, P>({ body: templateInput }, async ({ session, body, params }) => {
  await updateTemplate(session, params.id, body);
});

export const DELETE = apiRoute<undefined, P>({}, async ({ session, params }) => {
  await deleteTemplate(session, params.id);
});
