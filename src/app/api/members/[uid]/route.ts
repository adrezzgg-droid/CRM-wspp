import { apiRoute } from "@/server/api/handler";
import { updateMember } from "@/server/members/service";
import { memberUpdate } from "@/lib/schemas";

export const PATCH = apiRoute<typeof memberUpdate, { uid: string }>({ body: memberUpdate }, async ({ session, body, params }) => {
  await updateMember(session, params.uid, body);
});
