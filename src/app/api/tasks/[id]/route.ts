import { apiRoute } from "@/server/api/handler";
import { loadTask, updateTask } from "@/server/tasks/service";
import { taskUpdate } from "@/lib/schemas";

type P = { id: string };

export const GET = apiRoute<undefined, P>({}, async ({ session, params }) => ({ task: await loadTask(session, params.id) }));

export const PATCH = apiRoute<typeof taskUpdate, P>({ body: taskUpdate }, async ({ session, body, params }) => ({
  task: await updateTask(session, params.id, body),
}));
