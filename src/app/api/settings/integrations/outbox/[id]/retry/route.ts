import { apiRoute } from "@/server/api/handler";
import { retryOutboxItem } from "@/server/connectors/service";

export const POST = apiRoute<undefined, { id: string }>({}, async ({ session, params }) => retryOutboxItem(session, params.id));
