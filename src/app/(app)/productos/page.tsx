import type { Metadata } from "next";
import { requireAccess } from "@/server/auth/guards";
import { ModulePending, PageBody, PageHeader } from "@/components/ui/page";

export const metadata: Metadata = { title: "Productos" };

export default async function Page() {
  await requireAccess("productos");
  return (
    <PageBody>
      <PageHeader title="Productos" description="Catálogo de productos y precios." />
      <ModulePending
        phase={5}
        items={[
          "Alta y edición de productos",
          "Precios y unidades",
          "Sincronización con el sistema de gestión"
        ]}
      />
    </PageBody>
  );
}
