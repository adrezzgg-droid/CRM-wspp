import { apiRoute, ApiError } from "@/server/api/handler";
import { createTask, listTasks, taskCounts } from "@/server/tasks/service";
import { taskInput, taskListQuery } from "@/lib/schemas";

export const GET = apiRoute({}, async ({ req, session }) => {
  const parsed = taskListQuery.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) throw new ApiError(422, "Filtros inválidos", parsed.error.issues);
  const [items, counts] = await Promise.all([listTasks(session, parsed.data), taskCounts(session, parsed.data.responsable)]);
  return { items, counts };
});

export const POST = apiRoute({ body: taskInput }, async ({ session, body }) => ({ task: await createTask(session, body) }));
