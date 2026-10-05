import { apiRoute } from "@/server/api/handler";
import { assignDriver } from "@/server/commercial/orders";
import { orderDriverInput } from "@/lib/schemas";

export const POST = apiRoute<typeof orderDriverInput, { id: string }>({ body: orderDriverInput }, async ({ session, body, params }) => {
  await assignDriver(session, params.id, body.driverId);
});
