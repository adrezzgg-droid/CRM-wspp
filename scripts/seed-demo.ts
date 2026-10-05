/**
 * Crea (o reinicia) la organización DEMO con un usuario por rol.
 *
 *   npm run seed:demo                 → contra los emuladores (.env.local)
 *   npm run seed:demo -- --remoto     → contra el proyecto real; exige DEMO_PASSWORD
 *
 * Todo vive en la organización "demo" con isDemo: true. Nunca toca otra.
 */
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import type { Role } from "../src/server/permissions/matrix.ts";
import type { Customer, CustomerStage } from "../src/types/model.ts";
import { customerKeywords } from "../src/lib/search.ts";
import { toWhatsappId } from "../src/lib/phone.ts";
import { buildInboundPayload, messagePreview, parseWebhook, type MetaMessage } from "../src/lib/whatsapp/webhook.ts";
import { ingestInbound } from "../src/server/inbox/ingest-core.ts";
import { msToZoned, zonedTimeToMs } from "../src/lib/tasks.ts";
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
  for (const name of ["customers", "activities", "notes", "contacts", "conversations", "leads", "assignments", "opportunities", "orders", "products", "outbox", "tasks"]) {
    const old = await db.collection(`organizations/${ORG_ID}/${name}`).get();
    if (name === "conversations") {
      for (const c of old.docs) {
        const msgs = await c.ref.collection("messages").get();
        for (let i = 0; i < msgs.docs.length; i += 400) {
          const del = db.batch();
          msgs.docs.slice(i, i + 400).forEach((d) => del.delete(d.ref));
          await del.commit();
        }
      }
    }
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

/**
 * Conversaciones de ejemplo. Entran por la MISMA ingestión que un webhook de
 * Meta (payload real → parser → ingestInbound), no se escriben a mano.
 */
async function seedConversations(db: Firestore, uids: Record<string, string>) {
  const now = Date.now();
  const account = {
    id: "demo",
    orgId: ORG_ID,
    isDemo: true,
    displayPhone: "+54 9 351 000-0000 (demo)",
    phoneNumberId: `demo-${ORG_ID}`,
    wabaId: "demo",
    verifyTokenSet: false,
    tokenSet: false,
    connectionStatus: "sin_configurar",
    webhookStatus: "sin_verificar",
    createdAt: now,
    createdBy: "system",
    updatedAt: now,
    updatedBy: "system",
  };
  await db.doc(`organizations/${ORG_ID}/whatsappAccounts/demo`).set(account);
  // Reglas de asignación del demo: automáticas, por zona y alerta a los 15 min.
  await db.doc(`organizations/${ORG_ID}/settings/assignment`).set({ autoAssign: true, useZones: true, zoneFallback: true, slaEnabled: true, slaMinutes: 15, updatedAt: now, updatedBy: "system" });
  // El turno arranca de cero en cada reinicio.
  for (const uid of Object.values(uids)) await db.doc(`organizations/${ORG_ID}/members/${uid}`).update({ lastAutoAssignedAt: FieldValue.delete() });
  const target = { orgId: ORG_ID, isDemo: true, accountId: "demo" };

  let n = 0;
  async function inbound(phone: string, name: string, minutesAgo: number, message: Omit<MetaMessage, "from" | "id" | "timestamp">) {
    n += 1;
    const payload = buildInboundPayload({
      phoneNumberId: account.phoneNumberId,
      displayPhone: account.displayPhone,
      from: toWhatsappId(phone, "54")!,
      profileName: name,
      wamid: `wamid.seed.${n}`,
      timestamp: now - minutesAgo * 60_000,
      message,
    });
    const [m] = parseWebhook(payload).messages;
    return ingestInbound(db, target, m);
  }
  async function reply(conversationId: string, sender: string, text: string, minutesAgo: number) {
    n += 1;
    const ts = now - minutesAgo * 60_000;
    const ref = db.doc(`organizations/${ORG_ID}/conversations/${conversationId}`);
    await ref.collection("messages").doc(`wamid.demo.seed${n}`).set({
      id: `wamid.demo.seed${n}`, orgId: ORG_ID, isDemo: true, conversationId, direction: "out", type: "text", text, senderId: sender, status: "read", timestamp: ts, createdAt: ts,
    });
    await ref.update({ lastMessageAt: ts, lastMessagePreview: messagePreview({ type: "text", text }), lastMessageDirection: "out", awaitingReply: false, awaitingSince: FieldValue.delete(), unreadCount: 0, status: "en_atencion", firstResponseAt: ts });
  }
  const text = (body: string) => ({ type: "text", text: { body } });

  // Cliente activo de Juan: se asigna solo a él (responsable del cliente).
  const jose = await inbound("351 555 1234", "José Fernández", 95, text("Buen día! Para mañana necesito 20 kg de pechuga y 10 de alitas"));
  await reply(jose.conversationId, uids.vendedor1, "Buen día José! Te lo anoto para mañana a primera hora 👍", 90);
  await inbound("351 555 1234", "José Fernández", 12, text("Ah, y sumame 5 kg de muslo por favor"));

  // Cliente de María, con ubicación.
  await inbound("3543 44 1122", "Carolina Vega", 40, text("Hola María, ¿me pasás la lista de precios mayorista?"));
  await inbound("3543 44 1122", "Carolina Vega", 39, { type: "location", location: { latitude: -31.2919, longitude: -64.2913, name: "Mayorista Norte", address: "Villa Allende" } });

  // Leads nuevos: se reparten solos por turno entre los vendedores disponibles.
  await inbound("351 666 1010", "Martín Acosta", 25, text("Hola, tengo una rotisería en barrio Jardín. ¿Hacen envíos? ¿Cuál es el mínimo?"));
  await inbound("351 666 2020", "Restó La Esquina", 8, text("Buenas, ¿precio del pollo entero por cajón?"));
  await inbound("351 666 2020", "Restó La Esquina", 7, { type: "interactive", interactive: { type: "button_reply", button_reply: { id: "precios", title: "Ver precios" } } });

  // Prospecto existente sin responsable, con zona Centro: va al vendedor de esa zona.
  await inbound("351 555 6789", "Valeria Castro", 180, text("¿Siguen teniendo la promo de alitas?"));

  // Conversación cerrada.
  const cerrada = await inbound("3543 44 2233", "Pablo Giménez", 60 * 26, text("Gracias, llegó todo bien"));
  await reply(cerrada.conversationId, uids.vendedor2, "¡Genial Pablo! Cualquier cosa avisame", 60 * 25);
  await db.doc(`organizations/${ORG_ID}/conversations/${cerrada.conversationId}`).update({ status: "cerrada", closedAt: now - 60 * 25 * 60_000 });
}

/** Catálogo de una distribuidora avícola y oportunidades abiertas de ejemplo. */
async function seedCatalogAndPipeline(db: Firestore, uids: Record<string, string>) {
  const now = Date.now();
  const base = { orgId: ORG_ID, isDemo: true, createdAt: now, createdBy: "system", updatedAt: now, updatedBy: "system" };
  const batch = db.batch();
  const PRODUCTS: [string, string, string, number][] = [
    ["POL-ENT", "Pollo entero", "kg", 3200],
    ["PEC", "Pechuga sin hueso", "kg", 6900],
    ["ALI", "Alitas", "kg", 2900],
    ["MUS", "Muslo", "kg", 3600],
    ["PAT", "Pata y muslo", "kg", 3400],
    ["MIL", "Milanesa de pollo", "kg", 7800],
    ["HAM", "Hamburguesa de pollo x 4", "caja", 4200],
    ["HUE", "Huevos blancos x 30", "maple", 5600],
    ["CAJ-POL", "Pollo entero cajón x 10", "cajón", 30500],
  ];
  for (const [sku, name, unit, price] of PRODUCTS) {
    const ref = db.collection(`organizations/${ORG_ID}/products`).doc(sku.toLowerCase());
    batch.set(ref, { ...base, id: ref.id, sku, name, unit, price, active: true });
  }
  batch.set(db.doc(`organizations/${ORG_ID}/settings/counters`), { orders: 0 });

  const OPPS: [string, string, string, string, number, string, string, number][] = [
    // cliente, nombre, responsable, etapa, valor, producto, próxima acción, días en la etapa
    ["demo-cliente-1", "José Fernández", "vendedor1", "negociacion", 250000, "Pedido semanal de pechuga y alitas", "Confirmar precio por volumen el jueves", 2],
    ["demo-cliente-3", "Ricardo Sosa", "vendedor1", "contactado", 120000, "Milanesas para la parrilla", "Llevar muestras", 9],
    ["demo-cliente-6", "Carolina Vega", "vendedor2", "cotizacion", 480000, "Cajones de pollo entero mensual", "Enviar cotización mayorista", 1],
    ["demo-cliente-9", "Hernán Ruiz", "vendedor2", "interesado", 90000, "Alitas para el bar", "Llamar el lunes", 4],
  ];
  const stages: Record<string, number> = { contactado: 20, interesado: 35, cotizacion: 50, negociacion: 65 };
  for (const [customerId, customerName, owner, stageId, value, product, nextAction, days] of OPPS) {
    const ref = db.collection(`organizations/${ORG_ID}/opportunities`).doc();
    batch.set(ref, {
      ...base,
      id: ref.id,
      customerId,
      customerName,
      ownerId: uids[owner],
      pipelineId: "principal",
      stageId,
      estimatedValue: value,
      product,
      probability: stages[stageId],
      nextAction,
      stageChangedAt: now - days * 86_400_000,
    });
  }
  await batch.commit();
}

/** Tareas de ejemplo: vencidas, de hoy y próximas, en la zona horaria de la empresa. */
async function seedTasks(db: Firestore, uids: Record<string, string>) {
  const tz = "America/Argentina/Cordoba";
  const now = Date.now();
  const day = (offset: number) => msToZoned(now + offset * 86_400_000, tz).date;
  const base = { orgId: ORG_ID, isDemo: true, status: "pendiente", createdAt: now, createdBy: "system", updatedAt: now, updatedBy: "system" };
  const TASKS: [string, string, string | null, string | null, number, string, string, string][] = [
    // responsable, tipo, cliente, nombre, día (0 = hoy), hora, prioridad, descripción
    ["vendedor1", "llamada", "demo-cliente-4", "Marta López", -2, "10:00", "alta", "Llamar para reactivar: hace un mes que no compra"],
    ["vendedor1", "visita", "demo-cliente-3", "Ricardo Sosa", 0, "11:30", "normal", "Llevar muestras de milanesas"],
    ["vendedor1", "whatsapp", "demo-cliente-2", "Laura Medina", 0, "17:00", "normal", "Mandar la lista de precios nueva"],
    ["vendedor1", "cotizacion", "demo-cliente-1", "José Fernández", 2, "09:00", "normal", "Cotizar volumen mensual"],
    ["vendedor2", "seguimiento", "demo-cliente-6", "Carolina Vega", -1, "15:00", "normal", "Confirmar si recibió la cotización"],
    ["vendedor2", "postventa", "demo-cliente-7", "Pablo Giménez", 0, "12:00", "baja", "Preguntar cómo llegó el último pedido"],
    ["repartidor", "visita", null, null, 0, "08:00", "normal", "Cargar el camión de la tarde"],
  ];
  const batch = db.batch();
  for (const [who, type, customerId, customerName, offset, time, priority, description] of TASKS) {
    const ref = db.collection(`organizations/${ORG_ID}/tasks`).doc();
    batch.set(ref, {
      ...base,
      id: ref.id,
      assigneeId: uids[who],
      type,
      priority,
      description,
      ...(customerId ? { customerId, customerName } : {}),
      dueAt: zonedTimeToMs(day(offset), time, tz),
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
await seedConversations(db, uids);
await seedCatalogAndPipeline(db, uids);
await seedTasks(db, uids);

console.log(`Demo listo: "${ORG_NAME}" (${ORG_ID})`);
for (const u of USERS) console.log(`  ${u.role.padEnd(13)} ${u.email}`);
console.log(isEmulator() ? "Contraseña: la de DEMO_PASSWORD o, en el emulador, la definida en este script." : "Contraseña: DEMO_PASSWORD.");
