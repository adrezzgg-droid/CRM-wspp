import type { Metadata } from "next";
import { requireAccess } from "@/server/auth/guards";
import { ModulePending, PageBody, PageHeader } from "@/components/ui/page";

export const metadata: Metadata = { title: "Clientes" };

export default async function Page() {
  await requireAccess("clientes");
  return (
    <PageBody>
      <PageHeader title="Clientes" description="Clientes y prospectos con su ficha 360°." />
      <ModulePending
        phase={2}
        items={[
          "Alta y edición de clientes",
          "Tipos: prospecto, nuevo, activo, inactivo, perdido",
          "Vendedor responsable y zona",
          "Historial de conversaciones, pedidos y tareas",
          "Totales de compra y ticket promedio",
          "Búsqueda y filtros"
        ]}
      />
    </PageBody>
  );
}
