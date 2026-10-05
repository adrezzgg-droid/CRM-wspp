import { apiRoute } from "@/server/api/handler";
import { setOwnAvailability } from "@/server/members/service";
import { availabilityInput } from "@/lib/schemas";

export const POST = apiRoute({ body: availabilityInput }, async ({ session, body }) => {
  await setOwnAvailability(session, body.available);
});
