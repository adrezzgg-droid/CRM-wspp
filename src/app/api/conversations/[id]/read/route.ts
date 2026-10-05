import { apiRoute } from "@/server/api/handler";
import { markRead } from "@/server/inbox/service";

export const POST = apiRoute<undefined, { id: string }>({}, async ({ session, params }) => {
  await markRead(session, params.id);
});
