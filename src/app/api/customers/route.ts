import { apiRoute, ApiError } from "@/server/api/handler";
import { createCustomer, listCustomers } from "@/server/customers/service";
import { customerInput, customerListQuery } from "@/lib/schemas";

export const GET = apiRoute({}, async ({ req, session }) => {
  const parsed = customerListQuery.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) throw new ApiError(422, "Filtros inválidos", parsed.error.issues);
  return listCustomers(session, parsed.data);
});

export const POST = apiRoute({ body: customerInput }, async ({ session, body }) => ({
  customer: await createCustomer(session, body),
}));
