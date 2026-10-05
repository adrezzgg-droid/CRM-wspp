import { apiRoute } from "@/server/api/handler";
import { deleteZone, updateZone } from "@/server/org/assignment";
import { zoneInput } from "@/lib/schemas";

type P = { id: string };

export const PATCH = apiRoute<typeof zoneInput, P>({ body: zoneInput }, async ({ session, body, params }) => {
  await updateZone(session, params.id, body);
});

export const DELETE = apiRoute<undefined, P>({}, async ({ session, params }) => {
  await deleteZone(session, params.id);
});
