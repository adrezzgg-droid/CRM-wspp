import { apiRoute } from "@/server/api/handler";
import { setMemberActive } from "@/server/members/service";
import { memberStatus } from "@/lib/schemas";

export const POST = apiRoute<typeof memberStatus, { uid: string }>({ body: memberStatus }, async ({ session, body, params }) => {
  await setMemberActive(session, params.uid, body.active);
});
