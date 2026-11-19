import { NextResponse, type NextRequest } from "next/server";
import { errorResponse } from "@/server/api/handler";
import { receiveGestionStatus } from "@/server/connectors/service";

/**
 * Entrada del sistema de gestión (estado del reparto de un pedido). Pública,
 * sin sesión: la autentica la firma X-CRM-Signature con el secreto compartido
 * de esa empresa. Contrato completo en docs/CONECTOR-GESTION.md.
 */
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: RouteContext<"/api/integrations/gestion/[orgId]">) {
  const { orgId } = await ctx.params;
  const raw = await req.text();
  if (raw.length > 100_000) return NextResponse.json({ error: "Demasiado grande" }, { status: 413 });
  try {
    return NextResponse.json({ ok: true, ...(await receiveGestionStatus(orgId, raw, req.headers.get("x-crm-signature"))) });
  } catch (error) {
    return errorResponse(error);
  }
}
