import { apiRoute } from "@/server/api/handler";
import { runSlaNow } from "@/server/org/assignment";

/** Revisa ya las conversaciones demoradas de la empresa (lo mismo que hace la tarea programada). */
export const POST = apiRoute({}, async ({ session }) => runSlaNow(session));
