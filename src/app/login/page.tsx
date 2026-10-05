import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { getSession } from "@/server/auth/session";
import { landingFor } from "@/lib/navigation";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Iniciar sesión" };

const appName = process.env.NEXT_PUBLIC_APP_NAME ?? "CRM WhatsApp";

/** Solo rutas internas: evita redirecciones abiertas a otros sitios. */
function safeNext(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : undefined;
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const next = safeNext((await searchParams).next);
  const session = await getSession();
  if (session) redirect(next ?? landingFor(session.role, session.overrides));

  return (
    <main className="grid min-h-full lg:grid-cols-2">
      <section className="relative hidden overflow-hidden bg-brand-900 p-12 text-brand-50 lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-2 text-lg font-semibold">
          <span className="grid size-9 place-items-center rounded-xl bg-brand-500 text-white">
            <MessageCircle className="size-5" aria-hidden />
          </span>
          {appName}
        </div>
        <div className="max-w-md space-y-4">
          <h1 className="text-4xl font-semibold leading-tight text-white">
            Cada conversación, un cliente. Cada cliente, una venta.
          </h1>
          <p className="text-brand-200">
            Centralizá los mensajes de WhatsApp, repartí los leads entre tu equipo y medí todo el
            proceso comercial en un solo lugar.
          </p>
        </div>
        <p className="text-sm text-brand-300">Acceso solo para usuarios autorizados.</p>
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -bottom-24 size-96 rounded-full bg-brand-700/60 blur-3xl"
        />
      </section>

      <section className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 text-lg font-semibold lg:hidden">
            <span className="grid size-9 place-items-center rounded-xl bg-brand-600 text-white">
              <MessageCircle className="size-5" aria-hidden />
            </span>
            {appName}
          </div>
          <h2 className="text-2xl font-semibold">Iniciar sesión</h2>
          <p className="mt-1 text-sm text-ink-muted">Ingresá con el email y la contraseña de tu cuenta.</p>
          <LoginForm next={next} />
        </div>
      </section>
    </main>
  );
}
