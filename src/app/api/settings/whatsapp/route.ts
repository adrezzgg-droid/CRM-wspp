import { apiRoute } from "@/server/api/handler";
import { disconnectWhatsapp, getWhatsappSettings, saveWhatsappConfig } from "@/server/whatsapp/service";
import { whatsappConfigInput } from "@/lib/schemas";

/** Estado de la conexión (sin secretos, salvo el Verify Token para pegar en Meta). */
export const GET = apiRoute({ permission: ["whatsapp_config", "ver"] }, async ({ session }) => getWhatsappSettings(session));

/** Conectar o actualizar el número: se prueba contra Meta antes de guardar. */
export const PUT = apiRoute({ body: whatsappConfigInput }, async ({ session, body }) => saveWhatsappConfig(session, body));

export const DELETE = apiRoute({}, async ({ session }) => disconnectWhatsapp(session));
