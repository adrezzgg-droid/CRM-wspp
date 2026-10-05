import { apiRoute } from "@/server/api/handler";
import { addCustomerNote } from "@/server/customers/service";
import { noteInput } from "@/lib/schemas";

export const POST = apiRoute<typeof noteInput, { id: string }>({ body: noteInput }, async ({ session, body, params }) => ({
  note: await addCustomerNote(session, params.id, body.text),
}));
