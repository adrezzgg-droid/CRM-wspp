import { apiRoute } from "@/server/api/handler";
import { passwordSetupLink } from "@/server/members/service";

export const POST = apiRoute<undefined, { uid: string }>({}, async ({ session, params }) => passwordSetupLink(session, params.uid));
