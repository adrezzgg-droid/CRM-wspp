import { requireSession } from "@/server/auth/guards";
import { configSectionsFor } from "@/lib/navigation";
import { PageBody, PageHeader } from "@/components/ui/page";
import { ConfigNav } from "./config-nav";

export default async function ConfigLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const sections = configSectionsFor(session.role, session.overrides).map(({ slug, label }) => ({
    slug,
    label,
  }));
  return (
    <PageBody>
      <PageHeader title="Configuración" />
      <div className="flex flex-col gap-6 lg:flex-row">
        <ConfigNav sections={sections} />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </PageBody>
  );
}
