import { apiRoute } from "@/server/api/handler";
import { createMember } from "@/server/members/service";
import { memberCreate } from "@/lib/schemas";

export const POST = apiRoute({ body: memberCreate }, async ({ session, body }) => createMember(session, body));
