import { apiRoute } from "@/server/api/handler";
import { submitTemplate } from "@/server/automations/service";

/** Enviar la plantilla a revisión de Meta. */
export const POST = apiRoute<undefined, { id: string }>({}, async ({ session, params }) => ({ template: await submitTemplate(session, params.id) }));
