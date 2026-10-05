import { apiRoute } from "@/server/api/handler";
import { deleteTag, updateTag } from "@/server/org/tags";
import { tagInput } from "@/lib/schemas";

type P = { id: string };

export const PATCH = apiRoute<typeof tagInput, P>({ body: tagInput }, async ({ session, body, params }) => {
  await updateTag(session, params.id, body);
});

export const DELETE = apiRoute<undefined, P>({}, async ({ session, params }) => {
  await deleteTag(session, params.id);
});
