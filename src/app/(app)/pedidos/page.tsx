import type { Metadata } from "next";
import { requireAccess } from "@/server/auth/guards";
import { ModulePending, PageBody, PageHeader } from "@/components/ui/page";

export const metadata: Metadata = { title: "Pedidos" };

export default async function Page() {
  await requireAccess("pedidos");
  return (
    <PageBody>
      <PageHeader title="Pedidos" description="Pedidos generados desde el CRM." />
      <ModulePending
        phase={5}
        items={[
          "Creación de pedidos desde la conversación",
          "Número correlativo por empresa",
          "Estados hasta la entrega",
          "Envío al sistema de gestión (conector)",
          "Repartidor asignado",
          "Trazabilidad lead → venta → reparto"
        ]}
      />
    </PageBody>
  );
}
