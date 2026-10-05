import { apiRoute } from "@/server/api/handler";
import { loadConversation, updateConversation } from "@/server/inbox/service";
import { conversationUpdate } from "@/lib/schemas";

type P = { id: string };

export const GET = apiRoute<undefined, P>({}, async ({ session, params }) => ({
  conversation: await loadConversation(session, params.id),
}));

export const PATCH = apiRoute<typeof conversationUpdate, P>({ body: conversationUpdate }, async ({ session, body, params }) => {
  await updateConversation(session, params.id, body);
});
