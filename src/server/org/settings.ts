import "server-only";
import type { z } from "zod";
import type { Organization } from "@/types/model";
import { COLLECTIONS, orgPath } from "@/types/model";
import { adminDb } from "@/server/firebase/admin";
import { ApiError } from "@/server/api/handler";
import { recordAuditIn } from "@/server/audit";
import { can, type PolicyOverrides } from "@/server/permissions/matrix";
import type { Session } from "@/server/auth/session";
import type { generalSettingsInput, organizationUpdate, permissionsInput } from "@/lib/schemas";
import { getGeneralSettings } from "./data";

function requireConfig(session: Session) {
  if (!can(session.role, "configuracion", "editar", session.overrides)) {
    throw new ApiError(403, "No tenés permiso para cambiar la configuración");
  }
}

/**
 * Permisos por rol de la organización. Solo un ADMINISTRADOR (por rol, no por
 * permiso delegado) puede cambiarlos: si no, alguien con acceso a "usuarios"
 * podría ampliarse sus propios permisos.
 */
export async function savePermissions(session: Session, input: z.output<typeof permissionsInput>) {
  if (session.role !== "admin") throw new ApiError(403, "Solo un administrador puede cambiar los permisos");
  const ref = adminDb().collection(orgPath(session.orgId, "settings")).doc("permissions");
  const before = ((await ref.get()).data()?.overrides ?? {}) as PolicyOverrides;
  const now = Date.now();
  const batch = adminDb().batch();
  batch.set(ref, { overrides: input.overrides, updatedAt: now, updatedBy: session.uid });
  recordAuditIn(batch, {
    orgId: session.orgId,
    isDemo: session.org.isDemo,
    actorId: session.uid,
    action: "permissions.updated",
    target: { collection: "settings", id: "permissions" },
    before,
    after: input.overrides,
  }, now);
  await batch.commit();
}

export async function updateOrganization(session: Session, input: z.output<typeof organizationUpdate>) {
  requireConfig(session);
  const ref = adminDb().collection(COLLECTIONS.organizations).doc(session.orgId);
  const current = (await ref.get()).data() as Organization;
  const now = Date.now();
  const batch = adminDb().batch();
  batch.update(ref, { ...input, updatedAt: now, updatedBy: session.uid });
  recordAuditIn(batch, {
    orgId: session.orgId,
    isDemo: session.org.isDemo,
    actorId: session.uid,
    action: "organization.updated",
    target: { collection: "organizations", id: session.orgId },
    before: { name: current.name, timezone: current.timezone, currency: current.currency },
    after: input,
  }, now);
  await batch.commit();
}

export async function saveGeneralSettings(session: Session, input: z.output<typeof generalSettingsInput>) {
  requireConfig(session);
  const before = await getGeneralSettings(session.orgId);
  const now = Date.now();
  const batch = adminDb().batch();
  batch.set(adminDb().collection(orgPath(session.orgId, "settings")).doc("general"), {
    ...input,
    updatedAt: now,
    updatedBy: session.uid,
  });
  recordAuditIn(batch, {
    orgId: session.orgId,
    isDemo: session.org.isDemo,
    actorId: session.uid,
    action: "settings.general_updated",
    target: { collection: "settings", id: "general" },
    before: { defaultCountryCode: before.defaultCountryCode, businessHours: before.businessHours },
    after: input,
  }, now);
  await batch.commit();
}
