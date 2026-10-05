import { apiRoute } from "@/server/api/handler";
import { assignConversation } from "@/server/inbox/service";
import { assignInput } from "@/lib/schemas";

export const POST = apiRoute<typeof assignInput, { id: string }>({ body: assignInput }, async ({ session, body, params }) => {
  await assignConversation(session, params.id, body.assigneeId);
});
