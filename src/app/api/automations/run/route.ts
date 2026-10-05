import { apiRoute } from "@/server/api/handler";
import { runAutomationsNow } from "@/server/automations/service";

/** Ejecuta ya las reglas por tiempo y las agendadas de esta empresa. */
export const POST = apiRoute({}, async ({ session }) => runAutomationsNow(session));
