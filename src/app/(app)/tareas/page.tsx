import type { Metadata } from "next";
import { requireAccess } from "@/server/auth/guards";
import { ModulePending, PageBody, PageHeader } from "@/components/ui/page";

export const metadata: Metadata = { title: "Tareas" };

export default async function Page() {
  await requireAccess("tareas");
  return (
    <PageBody>
      <PageHeader title="Tareas" description="Seguimiento comercial del equipo." />
      <ModulePending
        phase={6}
        items={[
          "Llamada, WhatsApp, visita, seguimiento, cotización, postventa",
          "Vistas: hoy, vencidas, próximas, completadas",
          "Responsable, prioridad y vencimiento",
          "Avisos de tareas vencidas"
        ]}
      />
    </PageBody>
  );
}
