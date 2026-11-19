import { apiRoute } from "@/server/api/handler";
import { getAttachment } from "@/server/inbox/service";
import { attachmentHeaders } from "@/lib/safe-content";

/** Entrega un adjunto tras verificar sesión y alcance (Storage no es accesible desde el navegador). */
export const GET = apiRoute<undefined, { id: string; messageId: string }>({}, async ({ req, session, params }) => {
  const index = Number(req.nextUrl.searchParams.get("i") ?? 0);
  const { buffer, mimeType, fileName } = await getAttachment(session, params.id, params.messageId, Number.isInteger(index) ? index : 0);
  const download = req.nextUrl.searchParams.get("descargar") === "1";
  return new Response(new Uint8Array(buffer), { headers: attachmentHeaders(mimeType, fileName, download) });
});
