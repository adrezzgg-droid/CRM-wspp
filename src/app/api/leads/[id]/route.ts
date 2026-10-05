import { apiRoute } from "@/server/api/handler";
import { updateLeadStatus } from "@/server/leads/service";
import { leadStatusInput } from "@/lib/schemas";

export const PATCH = apiRoute<typeof leadStatusInput, { id: string }>({ body: leadStatusInput }, async ({ session, body, params }) => ({
  lead: await updateLeadStatus(session, params.id, body),
}));
