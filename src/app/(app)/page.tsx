import { redirect } from "next/navigation";
import { requireSession } from "@/server/auth/guards";
import { landingFor } from "@/lib/navigation";

export default async function Home() {
  const session = await requireSession();
  redirect(landingFor(session.role, session.overrides));
}
