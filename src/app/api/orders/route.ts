import { apiRoute, ApiError } from "@/server/api/handler";
import { createOrder, listOrders } from "@/server/commercial/orders";
import { orderInput, orderListQuery } from "@/lib/schemas";

export const GET = apiRoute({}, async ({ req, session }) => {
  const parsed = orderListQuery.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) throw new ApiError(422, "Filtros inválidos", parsed.error.issues);
  return listOrders(session, parsed.data);
});

export const POST = apiRoute({ body: orderInput }, async ({ session, body }) => ({ order: await createOrder(session, body) }));
