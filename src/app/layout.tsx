import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { cookies } from "next/headers";
import { colorScheme, parseTheme, themeClass, THEME_COOKIE } from "@/lib/theme";
import { Geist_Mono, Nunito } from "next/font/google";
import "./globals.css";

// Misma tipografía que Impulse360 (Nunito). next/font la sirve desde el propio sitio (sin Google en el navegador).
const nunito = Nunito({ variable: "--font-nunito", subsets: ["latin"], weight: ["400", "500", "600", "700", "800", "900"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

const appName = process.env.NEXT_PUBLIC_APP_NAME ?? "CRM WhatsApp";

export const metadata: Metadata = {
  title: { default: appName, template: `%s · ${appName}` },
  description: "Centro de operaciones comercial sobre WhatsApp.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#4f46e5" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0f19" },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Todo se renderiza por pedido: así Next aplica el nonce de la CSP (src/proxy.ts)
  // a sus scripts. Las páginas ya dependían de la sesión, así que no cambia el costo.
  await connection();
  // Tema elegido en el menú de usuario (cookie): la página llega ya pintada, sin parpadeo.
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang="es-AR" className={`${nunito.variable} ${geistMono.variable} ${themeClass(theme)} h-full`} style={{ colorScheme: colorScheme(theme) }}>
      <body className="h-full font-sans">{children}</body>
    </html>
  );
}
