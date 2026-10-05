import { apiRoute } from "@/server/api/handler";
import { getAccessibleCustomer, updateCustomer } from "@/server/customers/service";
import { customerUpdate } from "@/lib/schemas";

type P = { id: string };

export const GET = apiRoute<undefined, P>({}, async ({ session, params }) => ({
  customer: await getAccessibleCustomer(session, params.id),
}));

export const PATCH = apiRoute<typeof customerUpdate, P>({ body: customerUpdate }, async ({ session, body, params }) => ({
  customer: await updateCustomer(session, params.id, body),
}));
