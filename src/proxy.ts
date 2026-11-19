import { NextResponse, type NextRequest } from "next/server";

/**
 * Corre antes de cada página (no en la API ni en archivos estáticos):
 *
 *  1. Chequeo optimista de sesión: sin cookie, al login. NO es la
 *     autorización (la cookie no se verifica acá); eso lo hacen cada página y
 *     endpoint con requireSession / requireAccess / apiRoute.
 *  2. Content-Security-Policy con un nonce nuevo por pedido: solo corren los
 *     scripts que emite Next con ese nonce (Next lo aplica solo, porque todas
 *     las páginas se renderizan por pedido; ver app/layout.tsx). El navegador
 *     solo se conecta con el propio sitio y con Firebase.
 */
const SESSION_COOKIE = "__session";
const PUBLIC_PATHS = ["/login"];

function contentSecurityPolicy(nonce: string): string {
  const dev = process.env.NODE_ENV === "development";
  // En desarrollo: React usa eval para los errores y el navegador habla con los emuladores.
  const devConnect = dev ? " http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*" : "";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    // Atributos style (anchos de barras, etc.): sin esto no se ven los gráficos.
    "style-src 'self' 'unsafe-inline'",
    // www.google.com: Firestore pide una imagen para probar la conexión cuando se corta.
    "img-src 'self' blob: data: https://www.google.com",
    "media-src 'self' blob:",
    "font-src 'self'",
    `connect-src 'self' https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com${devConnect}`,
    "worker-src 'self' blob:",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!isPublic && !request.cookies.has(SESSION_COOKIE)) {
    const login = new URL("/login", request.url);
    if (pathname !== "/") login.searchParams.set("next", pathname + search);
    return NextResponse.redirect(login);
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = contentSecurityPolicy(nonce);
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Todo menos: API (se protege sola), assets de Next y archivos estáticos.
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
