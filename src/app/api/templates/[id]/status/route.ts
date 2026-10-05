import { apiRoute } from "@/server/api/handler";
import { setTemplateStatus } from "@/server/automations/service";
import { templateStatusInput } from "@/lib/schemas";

/** Solo en el demo: simular la aprobación de Meta. */
export const POST = apiRoute<typeof templateStatusInput, { id: string }>({ body: templateStatusInput }, async ({ session, body, params }) => {
  await setTemplateStatus(session, params.id, body.metaStatus);
});
