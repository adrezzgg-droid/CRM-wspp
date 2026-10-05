import { apiRoute } from "@/server/api/handler";
import { setTaskStatus } from "@/server/tasks/service";
import { taskStatusInput } from "@/lib/schemas";

/** Completar (con resultado), cancelar o reabrir. */
export const POST = apiRoute<typeof taskStatusInput, { id: string }>({ body: taskStatusInput }, async ({ session, body, params }) => ({
  task: await setTaskStatus(session, params.id, body),
}));
