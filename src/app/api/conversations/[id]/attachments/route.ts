import { apiRoute, ApiError } from "@/server/api/handler";
import { sendAttachment } from "@/server/inbox/service";

/** Envía un archivo (multipart: file, caption). */
export const POST = apiRoute<undefined, { id: string }>({}, async ({ req, session, params }) => {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) throw new ApiError(422, "Falta el archivo");
  const caption = form?.get("caption");
  return { message: await sendAttachment(session, params.id, file, typeof caption === "string" && caption.trim() ? caption.trim().slice(0, 1024) : undefined) };
});
