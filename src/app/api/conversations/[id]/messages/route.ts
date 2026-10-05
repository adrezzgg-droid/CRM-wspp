import { apiRoute } from "@/server/api/handler";
import { addNote, sendText } from "@/server/inbox/service";
import { messageInput } from "@/lib/schemas";

/** Responder al cliente o dejar una nota interna. */
export const POST = apiRoute<typeof messageInput, { id: string }>({ body: messageInput }, async ({ session, body, params }) => ({
  message: body.note ? await addNote(session, params.id, body.text) : await sendText(session, params.id, body.text),
}));
