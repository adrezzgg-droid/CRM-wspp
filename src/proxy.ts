import { NextResponse, type NextRequest } from "next/server";

/**
 * Chequeo optimista: sin cookie de sesión, al login. NO es la autorización
 * (la cookie no se verifica acá); eso lo hace cada página y endpoint con
 * requireSession / requireAccess / apiRoute.
 */
const SESSION_COOKIE = "__session";

export function proxy(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  const login = new URL("/login", request.url);
  const { pathname, search } = request.nextUrl;
  if (pathname !== "/") login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: [
    // Todo menos: API (se protege sola), login, assets de Next y archivos estáticos.
    "/((?!api|login|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
