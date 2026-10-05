import { apiRoute } from "@/server/api/handler";
import { deleteContact, updateContact } from "@/server/customers/service";
import { contactInput } from "@/lib/schemas";

type P = { id: string; contactId: string };

export const PATCH = apiRoute<typeof contactInput, P>({ body: contactInput }, async ({ session, body, params }) => {
  await updateContact(session, params.id, params.contactId, body);
});

export const DELETE = apiRoute<undefined, P>({}, async ({ session, params }) => {
  await deleteContact(session, params.id, params.contactId);
});
