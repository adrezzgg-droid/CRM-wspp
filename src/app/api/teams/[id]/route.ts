import { apiRoute } from "@/server/api/handler";
import { deleteTeam, updateTeam } from "@/server/members/service";
import { teamInput } from "@/lib/schemas";

type P = { id: string };

export const PATCH = apiRoute<typeof teamInput, P>({ body: teamInput }, async ({ session, body, params }) => {
  await updateTeam(session, params.id, body);
});

export const DELETE = apiRoute<undefined, P>({}, async ({ session, params }) => {
  await deleteTeam(session, params.id);
});
