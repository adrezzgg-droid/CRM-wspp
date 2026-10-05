import { redirect } from "next/navigation";
import { requireSession } from "@/server/auth/guards";
import { configSectionsFor } from "@/lib/navigation";

export default async function ConfigIndex() {
  const session = await requireSession();
  const first = configSectionsFor(session.role, session.overrides)[0];
  redirect(first ? `/configuracion/${first.slug}` : "/sin-acceso");
}
