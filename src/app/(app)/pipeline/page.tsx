import type { Metadata } from "next";
import { requireAccess } from "@/server/auth/guards";
import { ModulePending, PageBody, PageHeader } from "@/components/ui/page";

export const metadata: Metadata = { title: "Pipeline" };

export default async function Page() {
  await requireAccess("pipeline");
  return (
    <PageBody>
      <PageHeader title="Pipeline" description="Oportunidades comerciales por etapa." />
      <ModulePending
        phase={5}
        items={[
          "Kanban con arrastrar y soltar",
          "Etapas: nuevo lead → venta / perdido",
          "Valor estimado y probabilidad",
          "Próxima acción y notas",
          "Filtro por vendedor",
          "Historial de cambios de etapa"
        ]}
      />
    </PageBody>
  );
}
