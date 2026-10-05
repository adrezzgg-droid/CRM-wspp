import { apiRoute } from "@/server/api/handler";
import { loadOrder } from "@/server/commercial/orders";

export const GET = apiRoute<undefined, { id: string }>({}, async ({ session, params }) => ({ order: await loadOrder(session, params.id) }));
