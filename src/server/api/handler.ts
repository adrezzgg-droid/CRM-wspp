import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import type { z } from "zod";
import { can, type Action, type Resource } from "@/server/permissions/matrix";
import { getSession, type Session } from "@/server/auth/session";
import { serverEnv } from "@/server/env";
import { isSameOrigin, SAFE_METHODS } from "./origin";

/** Error con código HTTP que se devuelve tal cual al cliente. */
export class ApiError extends Error {
  readonly status: number;
  readonly details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export interface ApiContext<B, P> {
  req: NextRequest;
  session: Session;
  body: B;
  params: P;
}

interface Options<S extends z.ZodType | undefined> {
  /** Permiso requerido sobre la matriz. Omitirlo = solo exige sesión. */
  permission?: [Resource, Action];
  /** Esquema zod del cuerpo JSON. */
  body?: S;
}

type BodyOf<S> = S extends z.ZodType ? z.infer<S> : undefined;

/**
 * Envoltorio de todos los endpoints autenticados:
 *   1. CSRF: en métodos que modifican, el Origin tiene que ser el propio sitio.
 *   2. Sesión válida (cookie verificada + miembro activo).
 *   3. Permiso sobre la matriz (con los overrides de la organización).
 *   4. Validación del cuerpo con zod.
 *   5. Errores uniformes { error, details? } sin filtrar detalles internos.
 */
export function apiRoute<
  S extends z.ZodType | undefined = undefined,
  P extends Record<string, string | string[]> = Record<string, never>,
>(opts: Options<S>, handler: (ctx: ApiContext<BodyOf<S>, P>) => Promise<unknown>) {
  return async (req: NextRequest, routeCtx: { params: Promise<P> }): Promise<Response> => {
    try {
      assertSameOriginIfMutating(req);

      const session = await getSession();
      if (!session) throw new ApiError(401, "No autenticado");

      if (opts.permission) {
        const [resource, action] = opts.permission;
        if (!can(session.role, resource, action, session.overrides)) {
          throw new ApiError(403, "No tenés permiso para esta acción");
        }
      }

      let body = undefined as BodyOf<S>;
      if (opts.body) {
        const json = await req.json().catch(() => {
          throw new ApiError(400, "El cuerpo no es JSON válido");
        });
        const parsed = opts.body.safeParse(json);
        if (!parsed.success) {
          throw new ApiError(422, "Datos inválidos", parsed.error.issues);
        }
        body = parsed.data as BodyOf<S>;
      }

      const params = (await routeCtx?.params) ?? ({} as P);
      const result = await handler({ req, session, body, params });
      return result instanceof Response ? result : NextResponse.json(result ?? { ok: true });
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export function assertSameOriginIfMutating(req: NextRequest): void {
  if (SAFE_METHODS.has(req.method)) return;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!isSameOrigin(req.headers.get("origin"), host, serverEnv().APP_URL)) {
    throw new ApiError(403, "Origen no permitido");
  }
}

export function errorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    return NextResponse.json(
      error.details === undefined ? { error: error.message } : { error: error.message, details: error.details },
      { status: error.status },
    );
  }
  console.error("[api] error no controlado", error);
  return NextResponse.json({ error: "Error interno" }, { status: 500 });
}
