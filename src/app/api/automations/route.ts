import { apiRoute } from "@/server/api/handler";
import { createAutomation, listAutomations, recentRuns } from "@/server/automations/service";
import { automationInput } from "@/lib/schemas";

export const GET = apiRoute({}, async ({ session }) => ({ items: await listAutomations(session), runs: await recentRuns(session) }));

export const POST = apiRoute({ body: automationInput }, async ({ session, body }) => ({ automation: await createAutomation(session, body) }));
