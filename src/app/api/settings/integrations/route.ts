import { apiRoute } from "@/server/api/handler";
import { getIntegrationsView, saveGestionConfig } from "@/server/connectors/service";
import { gestionConfigInput } from "@/lib/schemas";

export const GET = apiRoute({ permission: ["integraciones", "ver"] }, async ({ session }) => getIntegrationsView(session));

/** Conector con el sistema de gestión: dirección, eventos y secreto compartido. */
export const PUT = apiRoute({ body: gestionConfigInput }, async ({ session, body }) => saveGestionConfig(session, body));
