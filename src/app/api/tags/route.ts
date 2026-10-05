import { apiRoute } from "@/server/api/handler";
import { createTag } from "@/server/org/tags";
import { tagInput } from "@/lib/schemas";

export const POST = apiRoute({ body: tagInput }, async ({ session, body }) => ({ tag: await createTag(session, body) }));
