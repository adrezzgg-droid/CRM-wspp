import type { Metadata } from "next";
import { requireAccess } from "@/server/auth/guards";
import { ModulePending, PageBody, PageHeader } from "@/components/ui/page";

export const metadata: Metadata = { title: "Auditoría" };

export default async function Page() {
  await requireAccess("auditoria");
  return (
    <PageBody>
      <PageHeader title="Auditoría" description="Registro de seguridad y configuración." />
      <ModulePending
        phase={10}
        items={[
          "Inicios y cierres de sesión",
          "Cambios de roles y usuarios",
          "Cambios de configuración con valor anterior y nuevo",
          "Filtros por usuario, acción y fecha"
        ]}
      />
    </PageBody>
  );
}
