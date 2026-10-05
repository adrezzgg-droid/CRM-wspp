import "server-only";
import { FieldValue, type WriteBatch } from "firebase-admin/firestore";
import type { z } from "zod";
import type { Member, NotificationType, Team } from "@/types/model";
import { orgPath } from "@/types/model";
import { adminAuth, adminDb } from "@/server/firebase/admin";
import { ApiError } from "@/server/api/handler";
import { recordAuditIn } from "@/server/audit";
import { can, type Action } from "@/server/permissions/matrix";
import type { Session } from "@/server/auth/session";
import { getMembers, getTeams, getZones, OWNER_ROLES } from "@/server/org/data";
import { newMember } from "@/server/org/defaults";
import type { memberCreate, memberUpdate, teamInput } from "@/lib/schemas";
import { checkCreate, checkEdit, checkRoleChange, checkStatusChange } from "./guards";

type CreateInput = z.output<typeof memberCreate>;
type UpdateInput = z.output<typeof memberUpdate>;
type TeamInput = z.output<typeof teamInput>;

const col = (orgId: string, c: Parameters<typeof orgPath>[1]) => adminDb().collection(orgPath(orgId, c));

function requirePermission(session: Session, resource: "usuarios" | "equipos", action: Action) {
  if (!can(session.role, resource, action, session.overrides)) {
    throw new ApiError(403, "No tenés permiso para esta acción");
  }
}

function reject(reason: string | null, status = 409): void {
  if (reason) throw new ApiError(status, reason);
}

function actor(session: Session) {
  return { uid: session.uid, role: session.role };
}

async function activeAdmins(orgId: string): Promise<number> {
  return (await getMembers(orgId)).filter((m) => m.role === "admin" && m.active).length;
}

async function loadMember(session: Session, uid: string): Promise<Member> {
  const snap = await col(session.orgId, "members").doc(uid).get();
  if (!snap.exists) throw new ApiError(404, "Usuario no encontrado");
  return { ...(snap.data() as Member), id: snap.id };
}

async function assertKnownRefs(session: Session, teamIds?: string[], zoneIds?: string[]) {
  if (teamIds?.length) {
    const known = new Set((await getTeams(session.orgId)).map((t) => t.id));
    if (teamIds.some((t) => !known.has(t))) throw new ApiError(422, "Hay equipos que no existen", [{ path: ["teamIds"], message: "Equipo inexistente" }]);
  }
  if (zoneIds?.length) {
    const known = new Set((await getZones(session.orgId)).map((z) => z.id));
    if (zoneIds.some((z) => !known.has(z))) throw new ApiError(422, "Hay zonas que no existen", [{ path: ["zoneIds"], message: "Zona inexistente" }]);
  }
}

/** Mantiene `teams.memberIds` alineado con `member.teamIds`. */
function syncMemberTeams(batch: WriteBatch, orgId: string, uid: string, before: string[], after: string[]) {
  for (const t of after.filter((x) => !before.includes(x))) {
    batch.update(col(orgId, "teams").doc(t), { memberIds: FieldValue.arrayUnion(uid) });
  }
  for (const t of before.filter((x) => !after.includes(x))) {
    batch.update(col(orgId, "teams").doc(t), {
      memberIds: FieldValue.arrayRemove(uid),
      leaderIds: FieldValue.arrayRemove(uid),
    });
  }
}

function publicMember(m: Member) {
  return {
    id: m.id,
    displayName: m.displayName,
    email: m.email,
    phone: m.phone,
    role: m.role,
    teamIds: m.teamIds,
    zoneIds: m.zoneIds,
    active: m.active,
    available: m.available,
  };
}

// ─────────────────────────────── Usuarios ───────────────────────────────────

export async function createMember(session: Session, input: CreateInput) {
  requirePermission(session, "usuarios", "crear");
  reject(checkCreate(actor(session), input.role), 403);
  await assertKnownRefs(session, input.teamIds, input.zoneIds);

  const auth = adminAuth();
  let uid: string;
  let created = false;
  try {
    const existing = await auth.getUserByEmail(input.email);
    const otherOrg = existing.customClaims?.orgId;
    if (otherOrg && otherOrg !== session.orgId) throw new ApiError(409, "Ese email ya está registrado en otra empresa.");
    if (otherOrg === session.orgId) throw new ApiError(409, "Ese email ya es usuario de esta empresa.");
    uid = existing.uid;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if ((error as { code?: string }).code !== "auth/user-not-found") throw error;
    uid = (await auth.createUser({ email: input.email, displayName: input.displayName })).uid;
    created = true;
  }

  const member: Member = {
    ...newMember({
      uid,
      orgId: session.orgId,
      isDemo: session.org.isDemo,
      displayName: input.displayName,
      email: input.email,
      role: input.role,
      teamIds: input.teamIds,
      zoneIds: input.zoneIds,
      actor: session.uid,
    }),
    phone: input.phone,
  };

  const batch = adminDb().batch();
  batch.create(col(session.orgId, "members").doc(uid), member);
  syncMemberTeams(batch, session.orgId, uid, [], input.teamIds);
  recordAuditIn(batch, {
    orgId: session.orgId,
    isDemo: session.org.isDemo,
    actorId: session.uid,
    action: "member.created",
    target: { collection: "members", id: uid },
    after: publicMember(member),
  });
  await batch.commit();
  await auth.setCustomUserClaims(uid, { orgId: session.orgId, role: input.role });

  // Enlace para que el usuario defina su contraseña (no se maneja ninguna contraseña acá).
  const setupLink = await auth.generatePasswordResetLink(input.email);
  return { member: publicMember(member), created, setupLink };
}

export async function updateMember(session: Session, uid: string, input: UpdateInput) {
  requirePermission(session, "usuarios", "editar");
  const current = await loadMember(session, uid);
  reject(checkEdit(actor(session), current), 403);
  if (input.role) reject(checkRoleChange(actor(session), current, input.role, await activeAdmins(session.orgId)));
  await assertKnownRefs(session, input.teamIds, input.zoneIds);

  const patch: Partial<Member> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v !== undefined || k === "phone") (patch as Record<string, unknown>)[k] = v;
  }
  const roleChanged = !!input.role && input.role !== current.role;
  const now = Date.now();
  const batch = adminDb().batch();
  batch.update(col(session.orgId, "members").doc(uid), {
    ...patch,
    ...("phone" in input && !input.phone ? { phone: FieldValue.delete() } : {}),
    updatedAt: now,
    updatedBy: session.uid,
  });
  if (input.teamIds) syncMemberTeams(batch, session.orgId, uid, current.teamIds ?? [], input.teamIds);
  recordAuditIn(batch, {
    orgId: session.orgId,
    isDemo: session.org.isDemo,
    actorId: session.uid,
    action: roleChanged ? "member.role_changed" : "member.updated",
    target: { collection: "members", id: uid },
    before: publicMember(current),
    after: publicMember({ ...current, ...patch }),
  }, now);
  await batch.commit();

  const auth = adminAuth();
  if (input.displayName && input.displayName !== current.displayName) {
    await auth.updateUser(uid, { displayName: input.displayName });
  }
  if (roleChanged) {
    await auth.setCustomUserClaims(uid, { orgId: session.orgId, role: input.role });
    // Sus sesiones abiertas dejan de valer: vuelve a entrar con el rol nuevo.
    await auth.revokeRefreshTokens(uid);
  }
}

/** Baja o reactivación. La baja conserva el usuario y todo su historial. */
export async function setMemberActive(session: Session, uid: string, active: boolean) {
  requirePermission(session, "usuarios", "eliminar");
  const current = await loadMember(session, uid);
  reject(checkStatusChange(actor(session), current, active, await activeAdmins(session.orgId)));
  if (current.active === active) return;

  const now = Date.now();
  const batch = adminDb().batch();
  batch.update(col(session.orgId, "members").doc(uid), {
    active,
    ...(active ? {} : { available: false }),
    updatedAt: now,
    updatedBy: session.uid,
  });
  recordAuditIn(batch, {
    orgId: session.orgId,
    isDemo: session.org.isDemo,
    actorId: session.uid,
    action: active ? "member.reactivated" : "member.deactivated",
    target: { collection: "members", id: uid },
    before: { active: current.active },
    after: { active },
  }, now);
  await batch.commit();

  const auth = adminAuth();
  await auth.updateUser(uid, { disabled: !active });
  if (!active) await auth.revokeRefreshTokens(uid);
}

export async function passwordSetupLink(session: Session, uid: string) {
  requirePermission(session, "usuarios", "editar");
  const member = await loadMember(session, uid);
  reject(checkEdit(actor(session), member), 403);
  if (!member.active) throw new ApiError(409, "El usuario está dado de baja.");
  return { setupLink: await adminAuth().generatePasswordResetLink(member.email) };
}

// ─────────────────────────────── Equipos ────────────────────────────────────

async function assertTeamPeople(session: Session, input: TeamInput) {
  const members = new Map((await getMembers(session.orgId)).map((m) => [m.id, m]));
  for (const id of input.leaderIds) {
    const m = members.get(id);
    if (!m?.active || (m.role !== "admin" && m.role !== "supervisor")) {
      throw new ApiError(422, "Los líderes tienen que ser supervisores o administradores activos", [{ path: ["leaderIds"], message: "Líder inválido" }]);
    }
  }
  for (const id of input.memberIds) {
    if (!members.get(id)?.active) {
      throw new ApiError(422, "Hay integrantes inexistentes o dados de baja", [{ path: ["memberIds"], message: "Integrante inválido" }]);
    }
  }
}

function teamPeople(t: Pick<Team, "leaderIds" | "memberIds">): string[] {
  return [...new Set([...t.leaderIds, ...t.memberIds])];
}

/** Agrega/quita el equipo en `member.teamIds` de quienes entran o salen. */
function syncTeamMembers(batch: WriteBatch, orgId: string, teamId: string, before: string[], after: string[]) {
  for (const uid of after.filter((x) => !before.includes(x))) {
    batch.update(col(orgId, "members").doc(uid), { teamIds: FieldValue.arrayUnion(teamId) });
  }
  for (const uid of before.filter((x) => !after.includes(x))) {
    batch.update(col(orgId, "members").doc(uid), { teamIds: FieldValue.arrayRemove(teamId) });
  }
}

export async function createTeam(session: Session, input: TeamInput): Promise<Team> {
  requirePermission(session, "equipos", "crear");
  await assertTeamPeople(session, input);
  const ref = col(session.orgId, "teams").doc();
  const now = Date.now();
  const team: Team = {
    id: ref.id,
    orgId: session.orgId,
    isDemo: session.org.isDemo,
    name: input.name,
    leaderIds: [...new Set(input.leaderIds)],
    memberIds: [...new Set(input.memberIds)],
    createdAt: now,
    createdBy: session.uid,
    updatedAt: now,
    updatedBy: session.uid,
  };
  const batch = adminDb().batch();
  batch.create(ref, team);
  syncTeamMembers(batch, session.orgId, ref.id, [], teamPeople(team));
  recordAuditIn(batch, {
    orgId: session.orgId,
    isDemo: session.org.isDemo,
    actorId: session.uid,
    action: "team.created",
    target: { collection: "teams", id: ref.id },
    after: { name: team.name, leaderIds: team.leaderIds, memberIds: team.memberIds },
  }, now);
  await batch.commit();
  return team;
}

async function loadTeam(session: Session, id: string): Promise<Team> {
  const snap = await col(session.orgId, "teams").doc(id).get();
  if (!snap.exists) throw new ApiError(404, "Equipo no encontrado");
  return { ...(snap.data() as Team), id: snap.id };
}

export async function updateTeam(session: Session, id: string, input: TeamInput) {
  requirePermission(session, "equipos", "editar");
  const current = await loadTeam(session, id);
  await assertTeamPeople(session, input);
  const next = { leaderIds: [...new Set(input.leaderIds)], memberIds: [...new Set(input.memberIds)] };
  const now = Date.now();
  const batch = adminDb().batch();
  batch.update(col(session.orgId, "teams").doc(id), { name: input.name, ...next, updatedAt: now, updatedBy: session.uid });
  syncTeamMembers(batch, session.orgId, id, teamPeople(current), teamPeople(next));
  recordAuditIn(batch, {
    orgId: session.orgId,
    isDemo: session.org.isDemo,
    actorId: session.uid,
    action: "team.updated",
    target: { collection: "teams", id },
    before: { name: current.name, leaderIds: current.leaderIds, memberIds: current.memberIds },
    after: { name: input.name, ...next },
  }, now);
  await batch.commit();
}

export async function deleteTeam(session: Session, id: string) {
  requirePermission(session, "equipos", "eliminar");
  const current = await loadTeam(session, id);
  const batch = adminDb().batch();
  batch.delete(col(session.orgId, "teams").doc(id));
  syncTeamMembers(batch, session.orgId, id, teamPeople(current), []);
  recordAuditIn(batch, {
    orgId: session.orgId,
    isDemo: session.org.isDemo,
    actorId: session.uid,
    action: "team.deleted",
    target: { collection: "teams", id },
    before: { name: current.name, leaderIds: current.leaderIds, memberIds: current.memberIds },
  });
  await batch.commit();
}

/** Cada vendedor decide si recibe leads automáticos (p.ej. al salir a reparto o fuera de turno). */
export async function setOwnAvailability(session: Session, available: boolean) {
  if (!OWNER_ROLES.has(session.role)) throw new ApiError(403, "Tu rol no recibe conversaciones");
  if (session.member.available === available) return;
  const now = Date.now();
  const batch = adminDb().batch();
  batch.update(col(session.orgId, "members").doc(session.uid), { available, updatedAt: now, updatedBy: session.uid });
  recordAuditIn(batch, {
    orgId: session.orgId,
    isDemo: session.org.isDemo,
    actorId: session.uid,
    action: "member.availability",
    target: { collection: "members", id: session.uid },
    before: { available: session.member.available },
    after: { available },
  }, now);
  await batch.commit();
}

/** Cada usuario elige qué avisos recibe. */
export async function setOwnNotificationPrefs(session: Session, prefs: Partial<Record<NotificationType, boolean>>) {
  const now = Date.now();
  const update: Record<string, unknown> = { updatedAt: now, updatedBy: session.uid };
  for (const [k, v] of Object.entries(prefs)) update[`notificationPrefs.${k}`] = v;
  await col(session.orgId, "members").doc(session.uid).update(update);
}
