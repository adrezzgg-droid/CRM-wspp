import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
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
  themeColor: "#4f46e5",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Todo se renderiza por pedido: así Next aplica el nonce de la CSP (src/proxy.ts)
  // a sus scripts. Las páginas ya dependían de la sesión, así que no cambia el costo.
  await connection();
  return (
    <html lang="es-AR" className={`${nunito.variable} ${geistMono.variable} h-full`}>
      <body className="h-full font-sans">{children}</body>
    </html>
  );
}
