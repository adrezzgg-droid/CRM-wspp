import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/server/auth/guards";
import { adminDb } from "@/server/firebase/admin";
import { CONFIG_SECTIONS, canSee } from "@/lib/navigation";
import { COLLECTIONS, type Organization } from "@/types/model";
import { ModulePending } from "@/components/ui/page";

const PENDING_ITEMS: Record<string, string[]> = {
  general: ["Idioma, zona horaria y moneda", "Horario de atención", "Preferencias del CRM"],
  usuarios: ["Invitar usuarios por email", "Asignar rol, equipo y zonas", "Dar de baja sin perder el historial"],
  roles: ["Matriz de permisos por rol", "Permisos configurables por empresa", "El administrador no puede ser degradado"],
  equipos: ["Equipos comerciales", "Supervisores y miembros", "Alcance de visibilidad por equipo"],
  zonas: ["Zonas y localidades", "Vendedor responsable por zona", "Asignación automática por zona"],
  whatsapp: ["Número conectado, Phone Number ID y WABA ID", "Access Token cifrado en el servidor", "URL y Verify Token del webhook", "Estado de conexión y prueba"],
  plantillas: ["Plantillas con variables {{nombre}}, {{pedido}}…", "Categorías de Meta", "Estado de aprobación en Meta"],
  etiquetas: ["Etiquetas con nombre y color", "Uso en conversaciones y clientes"],
  automatizaciones: ["Disparadores: nuevo WhatsApp, sin respuesta, pedido, sin compra", "Acciones: asignar, etiquetar, mensaje, tarea", "Historial de ejecuciones"],
  notificaciones: ["Elegir qué avisos recibir", "Nuevo lead, mensaje, tarea vencida, asignación…"],
  integraciones: ["Sistema de gestión de la distribuidora", "Cola de envíos con reintentos", "Google Sheets, Mercado Pago, ERP (futuro)"],
};

function findSection(slug: string) {
  return CONFIG_SECTIONS.find((s) => s.slug === slug);
}

export async function generateMetadata({ params }: PageProps<"/configuracion/[seccion]">): Promise<Metadata> {
  const section = findSection((await params).seccion);
  return { title: section ? `${section.label} · Configuración` : "Configuración" };
}

export default async function ConfigSectionPage({ params }: PageProps<"/configuracion/[seccion]">) {
  const section = findSection((await params).seccion);
  if (!section) notFound();
  const session = await requireSession();
  if (!canSee(session.role, section.resource, session.overrides)) redirect("/sin-acceso");

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{section.label}</h2>
        <p className="text-sm text-ink-muted">{section.description}</p>
      </div>
      {section.slug === "empresa" ? (
        <OrganizationDetails orgId={session.orgId} />
      ) : (
        <ModulePending phase={section.phase} items={PENDING_ITEMS[section.slug] ?? []} />
      )}
    </div>
  );
}

const dateFormat = new Intl.DateTimeFormat("es-AR", { dateStyle: "long" });

async function OrganizationDetails({ orgId }: { orgId: string }) {
  const snap = await adminDb().collection(COLLECTIONS.organizations).doc(orgId).get();
  const org = snap.data() as Organization | undefined;
  if (!org) notFound();

  const rows: [string, React.ReactNode][] = [
    ["Nombre", org.name],
    ["Identificador", <code key="id" className="font-mono text-xs">{orgId}</code>],
    ["Tipo", org.isDemo ? "Demostración" : "Producción"],
    ["Plan", org.plan],
    ["Estado", org.status === "active" ? "Activa" : "Suspendida"],
    ["Zona horaria", org.timezone],
    ["Moneda", org.currency],
    ["Alta", org.createdAt ? dateFormat.format(org.createdAt) : "—"],
  ];

  return (
    <section className="overflow-hidden rounded-xl border border-line bg-surface">
      <dl className="divide-y divide-line">
        {rows.map(([label, value]) => (
          <div key={label} className="grid gap-1 px-4 py-3 sm:grid-cols-3 sm:gap-4">
            <dt className="text-sm text-ink-muted">{label}</dt>
            <dd className="text-sm sm:col-span-2">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="border-t border-line bg-canvas px-4 py-3 text-xs text-ink-muted">
        La edición de estos datos llega en la Fase 2.
      </p>
    </section>
  );
}
