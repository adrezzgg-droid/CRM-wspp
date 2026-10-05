import { apiRoute } from "@/server/api/handler";
import { createZone } from "@/server/org/assignment";
import { zoneInput } from "@/lib/schemas";

export const POST = apiRoute({ body: zoneInput }, async ({ session, body }) => ({ zone: await createZone(session, body) }));
