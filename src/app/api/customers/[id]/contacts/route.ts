import { apiRoute } from "@/server/api/handler";
import { addContact } from "@/server/customers/service";
import { contactInput } from "@/lib/schemas";

export const POST = apiRoute<typeof contactInput, { id: string }>({ body: contactInput }, async ({ session, body, params }) => ({
  contact: await addContact(session, params.id, body),
}));
