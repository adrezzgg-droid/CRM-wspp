import { apiRoute } from "@/server/api/handler";
import { createOpportunity, listOpportunities } from "@/server/commercial/opportunities";
import { opportunityInput } from "@/lib/schemas";

export const GET = apiRoute({}, async ({ req, session }) => ({
  items: await listOpportunities(session, {
    owner: req.nextUrl.searchParams.get("owner") ?? undefined,
    q: req.nextUrl.searchParams.get("q") ?? undefined,
  }),
}));

export const POST = apiRoute({ body: opportunityInput }, async ({ session, body }) => ({ opportunity: await createOpportunity(session, body) }));
