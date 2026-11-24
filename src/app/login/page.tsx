import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { safeNextPath } from "@/lib/safe-content";
import { MessageCircle } from "lucide-react";
import { getSession } from "@/server/auth/session";
import { landingFor } from "@/lib/navigation";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Iniciar sesión" };

const appName = process.env.NEXT_PUBLIC_APP_NAME ?? "CRM WhatsApp";

/** Solo rutas internas: evita redirecciones abiertas a otros sitios. */
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const next = safeNextPath((await searchParams).next);
  const session = await getSession();
  if (session) redirect(next ?? landingFor(session.role, session.overrides));

  return (
    // Como el login de Impulse360: siempre oscuro (en los dos temas), con los mismos brillos índigo,
    // cian y rosa del fondo, y una tarjeta de vidrio oscuro al centro.
    <main
      className="flex min-h-full items-center justify-center bg-[#0b0f19] p-4"
      style={{
        backgroundImage:
          "radial-gradient(1100px 640px at 88% -10%, rgba(129,140,248,0.38), transparent 60%), radial-gradient(900px 620px at -10% 12%, rgba(34,211,238,0.24), transparent 58%), radial-gradient(1000px 700px at 50% 118%, rgba(236,72,153,0.16), transparent 60%)",
      }}
    >
      <div className="glass-card-dark fade-in w-full max-w-[380px] overflow-hidden rounded-xl !bg-[rgba(30,38,64,0.55)]">
        <div
          className="px-6 py-7 text-center"
          style={{
            background: "radial-gradient(420px 200px at 50% -40%, rgba(129,140,248,0.45), transparent 70%), linear-gradient(160deg, #25295A, #1E2640)",
            borderBottom: "1px solid transparent",
            borderImage: "linear-gradient(90deg, transparent, #818CF8, #22D3EE, transparent) 1",
          }}
        >
          <div className="mx-auto mb-2 grid size-12 place-items-center rounded bg-white/15 text-white">
            <MessageCircle className="size-6" aria-hidden />
          </div>
          <h1 className="text-xl font-bold tracking-[0.03em] text-white uppercase">{appName}</h1>
          <p className="text-xs tracking-wider text-white/85 uppercase">Cada conversación, un cliente</p>
        </div>
        <div className="px-5 py-5">
          <p className="mb-3 text-xs font-bold tracking-wide text-slate-400 uppercase">Ingreso del equipo</p>
          <LoginForm next={next} />
        </div>
      </div>
    </main>
  );
}
