import { apiRoute } from "@/server/api/handler";
import { changeOrderStatus } from "@/server/commercial/orders";
import { orderStatusInput } from "@/lib/schemas";

export const POST = apiRoute<typeof orderStatusInput, { id: string }>({ body: orderStatusInput }, async ({ session, body, params }) => ({
  order: await changeOrderStatus(session, params.id, body),
}));
