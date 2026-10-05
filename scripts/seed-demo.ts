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
import type { Customer, CustomerStage } from "../src/types/model.ts";
import { customerKeywords } from "../src/lib/search.ts";
import { toWhatsappId } from "../src/lib/phone.ts";
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
  const old = await db.collection(`organizations/${ORG_ID}/notifications`).get();
  const batch = db.batch();
  old.docs.forEach((d) => batch.delete(d.ref));
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

/** Clientes de ejemplo: [nombre, empresa, whatsapp, rubro, barrio, zona, responsable, etapa, etiquetas, reactivar] */
const CUSTOMERS: [string, string, string, string, string, string, string | null, CustomerStage, string[], boolean][] = [
  ["José Fernández", "Pollería Don José", "351 555 1234", "Pollería", "Güemes", "centro", "vendedor1", "cliente_activo", ["polleria", "cliente_activo"], false],
  ["Laura Medina", "Almacén La Esquina", "351 555 2345", "Almacén", "Alberdi", "centro", "vendedor1", "cliente_activo", ["almacen"], false],
  ["Ricardo Sosa", "Parrilla El Fogón", "351 555 3456", "Restaurante", "Nueva Córdoba", "centro", "vendedor1", "cliente_nuevo", ["restaurante", "nuevo"], false],
  ["Marta López", "Despensa Marta", "351 555 4567", "Almacén", "San Vicente", "centro", "vendedor1", "cliente_inactivo", ["almacen", "reactivar"], true],
  ["Diego Romero", "", "351 555 5678", "Restaurante", "Centro", "centro", "vendedor1", "prospecto", ["potencial"], false],
  ["Carolina Vega", "Mayorista Norte", "3543 44 1122", "Mayorista", "Villa Allende", "norte", "vendedor2", "cliente_activo", ["mayorista"], false],
  ["Pablo Giménez", "Rotisería Pablo", "3543 44 2233", "Rotisería", "Mendiolaza", "norte", "vendedor2", "cliente_nuevo", ["nuevo"], false],
  ["Silvia Ortiz", "Super Ortiz", "3547 55 3344", "Almacén", "Alta Gracia", "sur", "vendedor2", "cliente_perdido", ["almacen"], false],
  ["Hernán Ruiz", "Bar La Plaza", "3547 55 4455", "Restaurante", "Alta Gracia", "sur", "vendedor2", "prospecto", ["restaurante", "urgente"], false],
  ["Valeria Castro", "Pollería Valeria", "351 555 6789", "Pollería", "Cofico", "centro", null, "prospecto", ["polleria", "nuevo"], false],
  ["Gustavo Molina", "", "351 555 7890", "", "General Paz", "centro", null, "prospecto", ["nuevo"], false],
  ["Natalia Paz", "Kiosco Natalia", "3543 44 5566", "Kiosco", "Villa Allende", "norte", null, "prospecto", [], false],
];

async function seedCustomers(db: Firestore, uids: Record<string, string>) {
  const col = db.collection(`organizations/${ORG_ID}/customers`);
  // Reinicio: se borran los datos comerciales demo anteriores (solo en la org demo).
  for (const name of ["customers", "activities", "notes", "contacts"]) {
    const old = await db.collection(`organizations/${ORG_ID}/${name}`).get();
    for (let i = 0; i < old.docs.length; i += 400) {
      const del = db.batch();
      old.docs.slice(i, i + 400).forEach((d) => del.delete(d.ref));
      await del.commit();
    }
  }
  const batch = db.batch();
  const now = Date.now();
  CUSTOMERS.forEach(([name, company, phone, industry, neighborhood, zoneId, owner, stage, tagIds, reactivar], i) => {
    const ref = col.doc(`demo-cliente-${i + 1}`);
    const at = now - (CUSTOMERS.length - i) * 3_600_000;
    const ownerId = owner ? uids[owner] : null;
    const customer: Customer = {
      id: ref.id,
      orgId: ORG_ID,
      isDemo: true,
      name,
      company: company || undefined,
      phone,
      whatsappId: toWhatsappId(phone, "54") ?? undefined,
      industry: industry || undefined,
      neighborhood,
      locality: ZONES.find((z) => z.id === zoneId)?.localities[0],
      zoneId,
      ownerId,
      stage,
      needsReactivation: reactivar,
      tagIds,
      stats: { totalPurchased: 0, ordersCount: 0, avgTicket: 0 },
      archived: false,
      searchKeywords: [],
      createdAt: at,
      createdBy: ownerId ?? "system",
      updatedAt: at,
      updatedBy: ownerId ?? "system",
    };
    customer.searchKeywords = customerKeywords(customer);
    batch.set(ref, customer);
    const act = db.collection(`organizations/${ORG_ID}/activities`).doc();
    batch.set(act, { id: act.id, orgId: ORG_ID, isDemo: true, at, kind: "cliente.creado", customerId: ref.id, actorId: ownerId ?? "system", summary: "Cliente creado (datos de demostración)" });
  });
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
// Usuarios demo que no están en la lista (p.ej. creados por las pruebas): se eliminan.
const keep = new Set(Object.values(uids));
for (const doc of (await db.collection(`organizations/${ORG_ID}/members`).get()).docs) {
  if (keep.has(doc.id)) continue;
  await doc.ref.delete();
  const user = await auth.getUser(doc.id).catch(() => null);
  if (user?.customClaims?.orgId === ORG_ID) await auth.deleteUser(doc.id);
}
await seedZonesAndTeam(db, uids);
await seedNotifications(db, uids);
await seedCustomers(db, uids);

console.log(`Demo listo: "${ORG_NAME}" (${ORG_ID})`);
for (const u of USERS) console.log(`  ${u.role.padEnd(13)} ${u.email}`);
console.log(isEmulator() ? "Contraseña: la de DEMO_PASSWORD o, en el emulador, la definida en este script." : "Contraseña: DEMO_PASSWORD.");
