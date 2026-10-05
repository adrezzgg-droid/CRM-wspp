import { apiRoute } from "@/server/api/handler";
import { sendTemplate } from "@/server/inbox/service";
import { sendTemplateInput } from "@/lib/schemas";

/** Enviar una plantilla aprobada (también fuera de la ventana de 24 h). */
export const POST = apiRoute<typeof sendTemplateInput, { id: string }>({ body: sendTemplateInput }, async ({ session, body, params }) => ({
  message: await sendTemplate(session, params.id, body.templateId, body.values),
}));
