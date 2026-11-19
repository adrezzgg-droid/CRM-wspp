import { apiRoute, ApiError } from "@/server/api/handler";
import { exportAuditCsv } from "@/server/audit-query";
import { auditQuery } from "@/lib/schemas";

/** Descarga de la auditoría en CSV, con los filtros de la pantalla. */
export const GET = apiRoute({ permission: ["auditoria", "ver"] }, async ({ req, session }) => {
  const parsed = auditQuery.safeParse(Object.fromEntries([...req.nextUrl.searchParams].filter(([, v]) => v)));
  if (!parsed.success) throw new ApiError(422, "Filtros inválidos", parsed.error.issues);
  const { csv, truncated } = await exportAuditCsv(session, parsed.data);
  const day = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="auditoria-${day}.csv"`,
      "Cache-Control": "no-store",
      ...(truncated ? { "X-Truncated": "1" } : {}),
    },
  });
});
