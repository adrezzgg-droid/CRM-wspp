import { apiRoute } from "@/server/api/handler";
import { createTemplate, listTemplates } from "@/server/automations/service";
import { templateInput } from "@/lib/schemas";

export const GET = apiRoute({}, async ({ session }) => ({ items: await listTemplates(session) }));

export const POST = apiRoute({ body: templateInput }, async ({ session, body }) => ({ template: await createTemplate(session, body) }));
