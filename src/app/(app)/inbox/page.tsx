import type { Metadata } from "next";
import { requireAccess } from "@/server/auth/guards";
import { ModulePending, PageBody, PageHeader } from "@/components/ui/page";

export const metadata: Metadata = { title: "Bandeja" };

export default async function Page() {
  await requireAccess("inbox");
  return (
    <PageBody>
      <PageHeader title="Bandeja" description="Conversaciones de WhatsApp del equipo." />
      <ModulePending
        phase={3}
        items={[
          "Lista, chat y ficha del cliente en tres paneles",
          "Filtros: sin asignar, pendientes, mis conversaciones…",
          "Responder, enviar archivos e imágenes",
          "Notas internas y etiquetas",
          "Asignar y reasignar vendedor",
          "Crear cliente, tarea u oportunidad desde el chat"
        ]}
      />
    </PageBody>
  );
}
