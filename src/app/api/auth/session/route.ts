import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { adminAuth } from "@/server/firebase/admin";
import { serverEnv } from "@/server/env";
import { getSession, loadPrincipal, SESSION_COOKIE, type PrincipalError } from "@/server/auth/session";
import { ApiError, assertSameOriginIfMutating, errorResponse } from "@/server/api/handler";
import { recordAudit } from "@/server/audit";
import { landingFor } from "@/lib/navigation";

/** Solo se acepta un ID token recién emitido (login real, no un token robado viejo). */
const MAX_AUTH_AGE_SECONDS = 5 * 60;

const PRINCIPAL_MESSAGES: Record<PrincipalError, string> = {
  sin_organizacion: "Tu usuario no pertenece a ninguna organización. Pedile acceso a un administrador.",
  organizacion_inexistente: "La organización de tu usuario no existe.",
  organizacion_suspendida: "La organización está suspendida.",
  miembro_inexistente: "Tu usuario no está dado de alta en la organización.",
  miembro_inactivo: "Tu usuario está dado de baja.",
  rol_desactualizado: "Tu rol cambió. Volvé a iniciar sesión.",
};

const loginSchema = z.object({ idToken: z.string().min(1) });

function clientIp(req: NextRequest): string | undefined {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined;
}

/** Inicia sesión: canjea el ID token de Firebase Auth por una cookie httpOnly. */
export async function POST(req: NextRequest) {
  try {
    assertSameOriginIfMutating(req);
    const parsed = loginSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new ApiError(400, "Falta el token");

    const decoded = await adminAuth()
      .verifyIdToken(parsed.data.idToken, true)
      .catch(() => {
        throw new ApiError(401, "Token inválido o vencido");
      });
    if (Date.now() / 1000 - decoded.auth_time > MAX_AUTH_AGE_SECONDS) {
      throw new ApiError(401, "Volvé a iniciar sesión");
    }

    const principal = await loadPrincipal(decoded.uid, decoded.email ?? "", decoded);
    if ("error" in principal) throw new ApiError(403, PRINCIPAL_MESSAGES[principal.error]);
    const { session } = principal;

    const expiresIn = serverEnv().SESSION_DAYS * 24 * 60 * 60 * 1000;
    const cookie = await adminAuth().createSessionCookie(parsed.data.idToken, { expiresIn });

    await recordAudit({
      orgId: session.orgId,
      isDemo: session.org.isDemo,
      actorId: session.uid,
      action: "auth.login",
      target: { collection: "members", id: session.uid },
      ip: clientIp(req),
    });

    const res = NextResponse.json({ ok: true, landing: landingFor(session.role, session.overrides) });
    res.cookies.set(SESSION_COOKIE, cookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: expiresIn / 1000,
    });
    return res;
  } catch (error) {
    return errorResponse(error);
  }
}

/** Cierra la sesión en este navegador. */
export async function DELETE(req: NextRequest) {
  try {
    assertSameOriginIfMutating(req);
    const session = await getSession();
    if (session) {
      await recordAudit({
        orgId: session.orgId,
        isDemo: session.org.isDemo,
        actorId: session.uid,
        action: "auth.logout",
        target: { collection: "members", id: session.uid },
        ip: clientIp(req),
      });
    }
    const res = NextResponse.json({ ok: true });
    res.cookies.delete(SESSION_COOKIE);
    return res;
  } catch (error) {
    return errorResponse(error);
  }
}
