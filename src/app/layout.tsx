import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

const appName = process.env.NEXT_PUBLIC_APP_NAME ?? "CRM WhatsApp";

export const metadata: Metadata = {
  title: { default: appName, template: `%s · ${appName}` },
  description: "Centro de operaciones comercial sobre WhatsApp.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#1a6256",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es-AR" className={`${geistSans.variable} ${geistMono.variable} h-full`}>
      <body className="h-full font-sans">{children}</body>
    </html>
  );
}
