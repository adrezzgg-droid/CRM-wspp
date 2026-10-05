import type { Metadata } from "next";
import Link from "next/link";
import { Lock } from "lucide-react";
import { requireSession } from "@/server/auth/guards";
import { landingFor } from "@/lib/navigation";

export const metadata: Metadata = { title: "Sin acceso" };

export default async function NoAccessPage() {
  const session = await requireSession();
  const home = landingFor(session.role, session.overrides);
  return (
    <div className="grid min-h-full place-items-center p-6">
      <div className="max-w-sm text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-red-50 text-red-600">
          <Lock className="size-6" aria-hidden />
        </span>
        <h1 className="mt-4 text-lg font-semibold">No tenés acceso a esta sección</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Tu rol no tiene permiso para verla. Si lo necesitás, pedíselo a un administrador.
        </p>
        {home !== "/sin-acceso" && (
          <Link
            href={home}
            className="mt-6 inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
          >
            Volver al inicio
          </Link>
        )}
      </div>
    </div>
  );
}
