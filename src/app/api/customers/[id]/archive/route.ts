import { apiRoute } from "@/server/api/handler";
import { setCustomerArchived } from "@/server/customers/service";
import { archiveInput } from "@/lib/schemas";

export const POST = apiRoute<typeof archiveInput, { id: string }>({ body: archiveInput }, async ({ session, body, params }) => {
  await setCustomerArchived(session, params.id, body.archived);
});
