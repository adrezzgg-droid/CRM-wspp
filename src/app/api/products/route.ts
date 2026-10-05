import { apiRoute, ApiError } from "@/server/api/handler";
import { createProduct, listProducts } from "@/server/commercial/products";
import { productInput, productListQuery } from "@/lib/schemas";

export const GET = apiRoute({}, async ({ req, session }) => {
  const parsed = productListQuery.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) throw new ApiError(422, "Filtros inválidos", parsed.error.issues);
  return { items: await listProducts(session, parsed.data) };
});

export const POST = apiRoute({ body: productInput }, async ({ session, body }) => ({ product: await createProduct(session, body) }));
