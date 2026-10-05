import { apiRoute } from "@/server/api/handler";
import { updateProduct } from "@/server/commercial/products";
import { productInput } from "@/lib/schemas";

export const PATCH = apiRoute<typeof productInput, { id: string }>({ body: productInput }, async ({ session, body, params }) => {
  await updateProduct(session, params.id, body);
});
