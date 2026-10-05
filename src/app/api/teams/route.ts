import { apiRoute } from "@/server/api/handler";
import { createTeam } from "@/server/members/service";
import { teamInput } from "@/lib/schemas";

export const POST = apiRoute({ body: teamInput }, async ({ session, body }) => ({ team: await createTeam(session, body) }));
