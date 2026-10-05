/**
 * Utilidades de alta para los scripts de línea de comandos (no se empaquetan
 * con la app). Usan el Admin SDK con las mismas variables que el servidor.
 */
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import type { Role } from "../../src/server/permissions/matrix.ts";
import { DEFAULT_PIPELINE_ID, DEFAULT_PIPELINE_STAGES, DEFAULT_TAGS, newMember, newOrganization } from "../../src/server/org/defaults.ts";

export function isEmulator(): boolean {
  return !!(process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST);
}

export function initAdmin(): { auth: Auth; db: Firestore } {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error("Falta FIREBASE_PROJECT_ID");
  if (!getApps().length) {
    const { FIREBASE_CLIENT_EMAIL: clientEmail, FIREBASE_PRIVATE_KEY: key } = process.env;
    if (clientEmail && key) {
      initializeApp({ projectId, credential: cert({ projectId, clientEmail, privateKey: key.replace(/\\n/g, "\n") }) });
    } else if (isEmulator()) {
      initializeApp({ projectId });
    } else {
      throw new Error("Faltan FIREBASE_CLIENT_EMAIL y FIREBASE_PRIVATE_KEY (o configurar los emuladores).");
    }
  }
  const app = getApps()[0]!;
  const db = getFirestore(app);
  db.settings({ ignoreUndefinedProperties: true });
  return { auth: getAuth(app), db };
}

/** Lee `--clave valor` y `--bandera` de la línea de comandos. */
export function parseArgs(argv: string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[a.slice(2)] = true;
    else {
      out[a.slice(2)] = next;
      i++;
    }
  }
  return out;
}

/**
 * Busca o crea el usuario de Auth. Un usuario pertenece a una sola
 * organización: si ya tiene otra en sus claims, se aborta salvo `force`.
 */
export async function ensureUser(
  auth: Auth,
  input: { email: string; displayName: string; password?: string; orgId: string; force?: boolean },
): Promise<{ uid: string; created: boolean }> {
  try {
    const user = await auth.getUserByEmail(input.email);
    const currentOrg = user.customClaims?.orgId;
    if (currentOrg && currentOrg !== input.orgId && !input.force) {
      throw new Error(`${input.email} ya pertenece a la organización "${currentOrg}". Usá --forzar para moverlo.`);
    }
    await auth.updateUser(user.uid, {
      displayName: input.displayName,
      ...(input.password ? { password: input.password } : {}),
    });
    return { uid: user.uid, created: false };
  } catch (error) {
    if ((error as { code?: string }).code !== "auth/user-not-found") throw error;
    const user = await auth.createUser({
      email: input.email,
      displayName: input.displayName,
      password: input.password,
      emailVerified: false,
    });
    return { uid: user.uid, created: true };
  }
}

/** Alta (o actualización) del miembro y de sus custom claims, en ese orden. */
export async function upsertMember(
  auth: Auth,
  db: Firestore,
  input: {
    uid: string;
    orgId: string;
    isDemo: boolean;
    displayName: string;
    email: string;
    role: Role;
    teamIds?: string[];
    zoneIds?: string[];
  },
): Promise<void> {
  const member = newMember({ ...input, actor: "system" });
  await db.doc(`organizations/${input.orgId}/members/${input.uid}`).set(member);
  await auth.setCustomUserClaims(input.uid, { orgId: input.orgId, role: input.role });
  // Invalida sesiones con claims viejos.
  await auth.revokeRefreshTokens(input.uid);
}

/** Organización + pipeline + etiquetas + settings. Idempotente (ids fijos). */
export async function createOrganizationDocs(
  db: Firestore,
  input: { id: string; name: string; isDemo: boolean; timezone?: string; currency?: string },
): Promise<void> {
  const now = Date.now();
  const base = { orgId: input.id, isDemo: input.isDemo, createdAt: now, createdBy: "system", updatedAt: now, updatedBy: "system" };
  const batch = db.batch();
  const orgRef = db.doc(`organizations/${input.id}`);
  batch.set(orgRef, newOrganization({ ...input, actor: "system", now }));
  batch.set(orgRef.collection("pipelines").doc(DEFAULT_PIPELINE_ID), {
    ...base,
    id: DEFAULT_PIPELINE_ID,
    name: "Pipeline comercial",
    stages: DEFAULT_PIPELINE_STAGES,
  });
  for (const tag of DEFAULT_TAGS) batch.set(orgRef.collection("tags").doc(tag.id), { ...base, ...tag });
  batch.set(orgRef.collection("settings").doc("permissions"), { overrides: {}, updatedAt: now, updatedBy: "system" });
  batch.set(orgRef.collection("settings").doc("general"), { businessHours: null, updatedAt: now, updatedBy: "system" });
  const audit = orgRef.collection("auditLogs").doc();
  batch.set(audit, {
    id: audit.id,
    orgId: input.id,
    isDemo: input.isDemo,
    at: now,
    actorId: "system",
    action: "org.created",
    target: { collection: "organizations", id: input.id },
    after: { name: input.name, isDemo: input.isDemo },
  });
  await batch.commit();
}
