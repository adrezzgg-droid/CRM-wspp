import { apiRoute } from "@/server/api/handler";
import { syncTemplates } from "@/server/automations/service";

/** Traer de Meta el estado de aprobación de todas las plantillas. */
export const POST = apiRoute({}, async ({ session }) => syncTemplates(session));
