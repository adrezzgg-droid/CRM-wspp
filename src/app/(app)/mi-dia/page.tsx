import type { Metadata } from "next";
import { requireAccess } from "@/server/auth/guards";
import { ModulePending, PageBody, PageHeader } from "@/components/ui/page";

export const metadata: Metadata = { title: "Mi día" };

export default async function Page() {
  await requireAccess("mi_dia");
  return (
    <PageBody>
      <PageHeader title="Mi día" description="Todo lo que tenés que hacer hoy, en un solo lugar." />
      <ModulePending
        phase={6}
        items={[
          "Nuevos leads asignados",
          "Mensajes sin responder",
          "Tareas de hoy y vencidas",
          "Clientes para seguir",
          "Oportunidades abiertas",
          "Pedidos del día"
        ]}
      />
    </PageBody>
  );
}
