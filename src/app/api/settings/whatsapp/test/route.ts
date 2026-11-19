import { apiRoute } from "@/server/api/handler";
import { testWhatsappConnection } from "@/server/whatsapp/service";

export const POST = apiRoute({}, async ({ session }) => testWhatsappConnection(session));
