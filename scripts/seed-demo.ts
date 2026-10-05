/**
 * Crea (o reinicia) la organización DEMO con un usuario por rol.
 *
 *   npm run seed:demo                 → contra los emuladores (.env.local)
 *   npm run seed:demo -- --remoto     → contra el proyecto real; exige DEMO_PASSWORD
 *
 * Todo vive en la organización "demo" con isDemo: true. Nunca toca otra.
 */
import type { Firestore } from "firebase-admin/firestore";
import type { Role } from "../src/server/permissions/matrix.ts";
import { createOrganizationDocs, ensureUser, initAdmin, isEmulator, parseArgs, upsertMember } from "./lib/provision.ts";

const ORG_ID = "demo";
const ORG_NAME = "Distribuidora Demo";

const args = parseArgs(process.argv.slice(2));
const remote = args.remoto === true;

if (!isEmulator() && !remote) {
  console.error("No hay emuladores configurados. Para cargar el demo en el proyecto real usá --remoto.");
  process.exit(1);
}
const password = process.env.DEMO_PASSWORD ?? (isEmulator() ? "demo1234" : undefined);
if (!password || password.length < 8) {
  console.error("Definí DEMO_PASSWORD (mínimo 8 caracteres) para cargar el demo fuera del emulador.");
  process.exit(1);
}

const ZONES = [
  { id: "centro", name: "Centro", localities: ["Córdoba Capital"] },
  { id: "norte", name: "Norte", localities: ["Villa Allende", "Mendiolaza"] },
  { id: "sur", name: "Sur", localities: ["Alta Gracia"] },
];

const USERS: { key: string; email: string; name: string; role: Role; zoneIds?: string[] }[] = [
  { key: "admin", email: "admin@demo.test", name: "Ana Administradora", role: "admin" },
  { key: "supervisor", email: "supervisor@demo.test", name: "Sofía Supervisora", role: "supervisor" },
  { key: "vendedor1", email: "vendedor1@demo.test", name: "Juan Pérez", role: "vendedor", zoneIds: ["centro"] },
  { key: "vendedor2", email: "vendedor2@demo.test", name: "María Gómez", role: "vendedor", zoneIds: ["norte", "sur"] },
  { key: "repartidor", email: "repartidor@demo.test", name: "Carlos Reparto", role: "repartidor" },
  { key: "lectura", email: "lectura@demo.test", name: "Lucía Consulta", role: "solo_lectura" },
];

async function seedZonesAndTeam(db: Firestore, uids: Record<string, string>) {
  const now = Date.now();
  const base = { orgId: ORG_ID, isDemo: true, createdAt: now, createdBy: "system", updatedAt: now, updatedBy: "system" };
  const batch = db.batch();
  for (const z of ZONES) batch.set(db.doc(`organizations/${ORG_ID}/zones/${z.id}`), { ...base, ...z });
  batch.set(db.doc(`organizations/${ORG_ID}/teams/comercial`), {
    ...base,
    id: "comercial",
    name: "Equipo comercial",
    leaderIds: [uids.supervisor],
    memberIds: [uids.vendedor1, uids.vendedor2],
  });
  await batch.commit();
}

async function seedNotifications(db: Firestore, uids: Record<string, string>) {
  const batch = db.batch();
  for (const u of USERS.filter((x) => x.zoneIds?.length)) {
    const ref = db.collection(`organizations/${ORG_ID}/notifications`).doc();
    batch.set(ref, {
      id: ref.id,
      orgId: ORG_ID,
      isDemo: true,
      userId: uids[u.key],
      type: "nueva_asignacion",
      title: `Te asignaron ${u.zoneIds!.length > 1 ? "las zonas" : "la zona"} ${u.zoneIds!.map((z) => ZONES.find((x) => x.id === z)?.name).join(" y ")}`,
      read: false,
      createdAt: Date.now(),
    });
  }
  await batch.commit();
}

const { auth, db } = initAdmin();
console.log(`Destino: ${isEmulator() ? "EMULADOR" : `proyecto ${process.env.FIREBASE_PROJECT_ID}`}`);

await createOrganizationDocs(db, { id: ORG_ID, name: ORG_NAME, isDemo: true });

const uids: Record<string, string> = {};
for (const u of USERS) {
  const { uid } = await ensureUser(auth, { email: u.email, displayName: u.name, password, orgId: ORG_ID });
  uids[u.key] = uid;
}
for (const u of USERS) {
  await upsertMember(auth, db, {
    uid: uids[u.key],
    orgId: ORG_ID,
    isDemo: true,
    displayName: u.name,
    email: u.email,
    role: u.role,
    zoneIds: u.zoneIds,
    teamIds: u.role === "vendedor" || u.role === "supervisor" ? ["comercial"] : [],
  });
}
await seedZonesAndTeam(db, uids);
await seedNotifications(db, uids);

console.log(`Demo listo: "${ORG_NAME}" (${ORG_ID})`);
for (const u of USERS) console.log(`  ${u.role.padEnd(13)} ${u.email}`);
console.log(isEmulator() ? "Contraseña: la de DEMO_PASSWORD o, en el emulador, la definida en este script." : "Contraseña: DEMO_PASSWORD.");
