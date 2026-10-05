import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/server/auth/guards";
import { adminDb } from "@/server/firebase/admin";
import { can } from "@/server/permissions/matrix";
import type { Session } from "@/server/auth/session";
import { getGeneralSettings, getMembers, getTags, getTeams, getZones, scopeContext } from "@/server/org/data";
import { CONFIG_SECTIONS, canSee } from "@/lib/navigation";
import { COLLECTIONS, type Organization } from "@/types/model";
import { ModulePending } from "@/components/ui/page";
import { UsersManager } from "../sections/users-manager";
import { RolesEditor } from "../sections/roles-editor";
import { TeamsManager } from "../sections/teams-manager";
import { GeneralForm, OrganizationForm } from "../sections/settings-forms";
import { TagsManager } from "../sections/tags-manager";
import { NotificationPrefsForm } from "../sections/notification-prefs";
import { TemplatesManager } from "../sections/templates-manager";
import { AutomationsManager } from "../sections/automations-manager";
import { listAutomations, listTemplates, recentRuns } from "@/server/automations/service";
import type { Member, NotificationType } from "@/types/model";
import { ZonesManager } from "../sections/zones-manager";
import { AssignmentForm } from "../sections/assignment-form";
import { getAssignmentSettings } from "@/server/org/assignment";
import { OWNER_ROLES } from "@/server/org/data";
import { orgPath } from "@/types/model";

const PENDING_ITEMS: Record<string, string[]> = {
  whatsapp: ["Número conectado, Phone Number ID y WABA ID", "Access Token cifrado en el servidor", "URL y Verify Token del webhook", "Estado de conexión y prueba"],
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
      <SectionBody slug={section.slug} phase={section.phase} session={session} />
    </div>
  );
}

async function SectionBody({ slug, phase, session }: { slug: string; phase: number; session: Session }) {
  const editConfig = can(session.role, "configuracion", "editar", session.overrides);

  switch (slug) {
    case "empresa": {
      const org = (await adminDb().collection(COLLECTIONS.organizations).doc(session.orgId).get()).data() as Organization;
      return <OrganizationForm initial={{ name: org.name, timezone: org.timezone, currency: org.currency }} readOnly={!editConfig} />;
    }
    case "general": {
      const g = await getGeneralSettings(session.orgId);
      return <GeneralForm initial={{ defaultCountryCode: g.defaultCountryCode, businessHours: g.businessHours }} readOnly={!editConfig} />;
    }
    case "usuarios": {
      const [members, teams, zones] = await Promise.all([getMembers(session.orgId), getTeams(session.orgId), getZones(session.orgId)]);
      return (
        <UsersManager
          members={members.map((m) => ({
            id: m.id,
            displayName: m.displayName,
            email: m.email,
            phone: m.phone,
            role: m.role,
            teamIds: m.teamIds ?? [],
            zoneIds: m.zoneIds ?? [],
            active: m.active,
            available: m.available,
          }))}
          teams={teams.map((t) => ({ id: t.id, name: t.name }))}
          zones={zones.map((z) => ({ id: z.id, name: z.name }))}
          currentUid={session.uid}
          currentRole={session.role}
          canCreate={can(session.role, "usuarios", "crear", session.overrides)}
          canEdit={can(session.role, "usuarios", "editar", session.overrides)}
          canDeactivate={can(session.role, "usuarios", "eliminar", session.overrides)}
        />
      );
    }
    case "roles":
      return <RolesEditor overrides={session.overrides} readOnly={session.role !== "admin"} />;
    case "equipos": {
      const [members, teams, ctx] = await Promise.all([getMembers(session.orgId), getTeams(session.orgId), scopeContext(session, "equipos")]);
      // Alcance "equipo": el supervisor solo ve los equipos que lidera.
      const visible = ctx.scope === "todo" ? teams : teams.filter((t) => t.leaderIds.includes(session.uid));
      return (
        <TeamsManager
          teams={visible.map((t) => ({ id: t.id, name: t.name, leaderIds: t.leaderIds, memberIds: t.memberIds }))}
          people={members
            .filter((m) => m.active)
            .sort((a, b) => a.displayName.localeCompare(b.displayName, "es"))
            .map((m) => ({ id: m.id, name: m.displayName, canLead: m.role === "admin" || m.role === "supervisor" }))}
          names={Object.fromEntries(members.map((m) => [m.id, m.displayName]))}
          canEdit={can(session.role, "equipos", "editar", session.overrides) && can(session.role, "equipos", "crear", session.overrides)}
          canDelete={can(session.role, "equipos", "eliminar", session.overrides)}
        />
      );
    }
    case "zonas": {
      const [zones, members] = await Promise.all([getZones(session.orgId), getMembers(session.orgId)]);
      const customers = adminDb().collection(orgPath(session.orgId, "customers"));
      const counts = await Promise.all(zones.map((z) => customers.where("zoneId", "==", z.id).where("archived", "==", false).count().get().then((r) => r.data().count)));
      const sellers = members.filter((m) => m.active && OWNER_ROLES.has(m.role)).sort((a, b) => a.displayName.localeCompare(b.displayName, "es"));
      return (
        <ZonesManager
          zones={zones
            .map((z, i) => ({ id: z.id, name: z.name, localities: z.localities ?? [], sellerIds: sellers.filter((m) => m.zoneIds?.includes(z.id)).map((m) => m.id), customers: counts[i] }))
            .sort((a, b) => a.name.localeCompare(b.name, "es"))}
          sellers={sellers.map((m) => ({ id: m.id, name: m.displayName, available: m.available }))}
          names={Object.fromEntries(members.map((m) => [m.id, m.displayName]))}
          canEdit={editConfig}
        />
      );
    }
    case "asignacion": {
      const [settings, members] = await Promise.all([getAssignmentSettings(session.orgId), getMembers(session.orgId)]);
      const sellers = members.filter((m) => m.active && m.role === "vendedor");
      return (
        <AssignmentForm
          initial={{ autoAssign: settings.autoAssign, useZones: settings.useZones, zoneFallback: settings.zoneFallback, slaEnabled: settings.slaEnabled, slaMinutes: settings.slaMinutes }}
          readOnly={!editConfig}
          canRunSla={can(session.role, "inbox", "asignar", session.overrides)}
          sellers={{ total: sellers.length, available: sellers.filter((m) => m.available).length }}
        />
      );
    }
    case "plantillas": {
      const templates = await listTemplates(session);
      return (
        <TemplatesManager
          templates={templates.map((t) => ({ id: t.id, name: t.name, category: t.category, language: t.language, body: t.body, metaStatus: t.metaStatus }))}
          canEdit={can(session.role, "plantillas", "editar", session.overrides) && can(session.role, "plantillas", "crear", session.overrides)}
          isDemo={session.org.isDemo}
        />
      );
    }
    case "automatizaciones": {
      const [automations, runs, tags, zones, templates] = await Promise.all([listAutomations(session), recentRuns(session), getTags(session.orgId), getZones(session.orgId), listTemplates(session)]);
      return (
        <AutomationsManager
          automations={automations}
          runs={runs}
          timezone={session.org.timezone}
          canEdit={can(session.role, "automatizaciones", "editar", session.overrides)}
          lookups={{
            tags: tags.map((t) => ({ id: t.id, name: t.name })),
            zones: zones.map((z) => ({ id: z.id, name: z.name })),
            templates: templates.map((t) => ({ id: t.id, name: t.name, approved: t.metaStatus === "aprobada" })),
          }}
        />
      );
    }
    case "notificaciones": {
      const me = (await adminDb().collection(orgPath(session.orgId, "members")).doc(session.uid).get()).data() as Member;
      // Cada rol ve solo los avisos que le pueden llegar.
      const types: NotificationType[] =
        session.role === "repartidor"
          ? ["nueva_asignacion", "tarea_vencida"]
          : session.role === "solo_lectura"
            ? []
            : ["nuevo_lead", "nuevo_mensaje", "cliente_esperando", "lead_sin_responder", "nueva_asignacion", "tarea_vencida", "pedido_generado", "cliente_reactivar", "automatizacion"];
      if (!types.length) return <p className="text-sm text-ink-muted">Tu rol no recibe avisos.</p>;
      return <NotificationPrefsForm types={types} initial={me.notificationPrefs ?? {}} />;
    }
    case "etiquetas": {
      const tags = (await getTags(session.orgId)).sort((a, b) => a.name.localeCompare(b.name, "es"));
      return (
        <TagsManager
          tags={tags.map((t) => ({ id: t.id, name: t.name, color: t.color }))}
          canCreate={can(session.role, "etiquetas", "crear", session.overrides)}
          canEdit={can(session.role, "etiquetas", "editar", session.overrides)}
          canDelete={can(session.role, "etiquetas", "eliminar", session.overrides)}
        />
      );
    }
    default:
      return <ModulePending phase={phase} items={PENDING_ITEMS[slug] ?? []} />;
  }
}
