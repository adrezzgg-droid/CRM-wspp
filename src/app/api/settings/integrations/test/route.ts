import { apiRoute } from "@/server/api/handler";
import { testGestion } from "@/server/connectors/service";

export const POST = apiRoute({}, async ({ session }) => testGestion(session));
