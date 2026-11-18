import { apiRoute, ApiError } from "@/server/api/handler";
import { getDashboard } from "@/server/dashboard/service";
import { dashboardQuery } from "@/lib/schemas";

export const GET = apiRoute({ permission: ["dashboard", "ver"] }, async ({ req, session }) => {
  const parsed = dashboardQuery.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) throw new ApiError(422, "Filtros inválidos", parsed.error.issues);
  return getDashboard(session, parsed.data);
});
