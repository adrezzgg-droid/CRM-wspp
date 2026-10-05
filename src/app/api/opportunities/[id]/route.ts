import { apiRoute } from "@/server/api/handler";
import { loadOpportunity, updateOpportunity } from "@/server/commercial/opportunities";
import { opportunityUpdate } from "@/lib/schemas";

type P = { id: string };

export const GET = apiRoute<undefined, P>({}, async ({ session, params }) => ({ opportunity: await loadOpportunity(session, params.id) }));

/** Edición y cambio de etapa (arrastrar en el tablero). */
export const PATCH = apiRoute<typeof opportunityUpdate, P>({ body: opportunityUpdate }, async ({ session, body, params }) => ({
  opportunity: await updateOpportunity(session, params.id, body),
}));
