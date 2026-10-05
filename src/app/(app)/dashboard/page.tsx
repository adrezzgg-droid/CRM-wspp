import type { Metadata } from "next";
import { requireAccess } from "@/server/auth/guards";
import { ModulePending, PageBody, PageHeader } from "@/components/ui/page";

export const metadata: Metadata = { title: "Dashboard" };

export default async function Page() {
  await requireAccess("dashboard");
  return (
    <PageBody>
      <PageHeader title="Dashboard" description="Resultados comerciales del equipo." />
      <ModulePending
        phase={8}
        items={[
          "Leads nuevos, atendidos y sin responder",
          "Tiempo promedio de respuesta",
          "Ventas y monto vendido por vendedor",
          "Tasa de conversión y embudo",
          "Clientes nuevos, reactivados, perdidos",
          "Filtros por período y rango personalizado"
        ]}
      />
    </PageBody>
  );
}
