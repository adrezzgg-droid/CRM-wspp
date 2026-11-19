/**
 * Pruebas de firestore.rules contra el emulador.
 *   npm run test:rules
 *
 * El navegador solo lee la bandeja (conversaciones, mensajes, lead) y sus
 * notificaciones; el alcance sale de la ficha del usuario (inboxScope,
 * scopeUids, active), que mantiene src/server/members/scope-core.ts.
 */
import { after, before, beforeEach, describe, test } from "node:test";
import { readFileSync } from "node:fs";
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, deleteDoc, where, type Firestore } from "firebase/firestore";

const ORG = "org1";
const OTHER = "org2";
let env: RulesTestEnvironment;

type Role = "admin" | "supervisor" | "vendedor" | "repartidor" | "solo_lectura";

function as(uid: string, role: Role, orgId = ORG): Firestore {
  return env.authenticatedContext(uid, { orgId, role }).firestore() as unknown as Firestore;
}
const anon = () => env.unauthenticatedContext().firestore() as unknown as Firestore;
const p = (path: string, orgId = ORG) => `organizations/${orgId}/${path}`;
const convs = (db: Firestore) => collection(db, p("conversations"));

before(async () => {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080").split(":");
  env = await initializeTestEnvironment({
    projectId: "demo-crm-whatsapp-rules",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host, port: Number(port) },
  });
});

after(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const set = (path: string, data: Record<string, unknown>) => db.doc(path).set(data);
    const member = (uid: string, role: Role, inboxScope: string, scopeUids: string[] = [], active = true, orgId = ORG) =>
      set(p(`members/${uid}`, orgId), { role, inboxScope, scopeUids, active });
    await set(`organizations/${ORG}`, { name: "Org 1", isDemo: false });
    await set(`organizations/${OTHER}`, { name: "Org 2", isDemo: false });
    await member("adm", "admin", "todo");
    await member("sup", "supervisor", "equipo", ["sup", "vend1"]);
    await member("vend1", "vendedor", "propio");
    await member("vend2", "vendedor", "propio");
    await member("baja", "vendedor", "todo", [], false);
    await member("rep1", "repartidor", "");
    await member("ro", "solo_lectura", "todo");
    await member("adm2", "admin", "todo", [], true, OTHER);
    await set(p("conversations/conv1"), { assigneeId: "vend1", status: "en_atencion" });
    await set(p("conversations/conv2"), { assigneeId: "vend2", status: "en_atencion" });
    await set(p("conversations/conv3"), { assigneeId: null, status: "nueva" });
    await set(p("conversations/conv1/messages/m1"), { text: "hola" });
    await set(p("conversations/conv2/messages/m2"), { text: "hola" });
    await set(p("leads/l1"), { ownerId: "vend1", status: "contactado" });
    await set(p("leads/l2"), { ownerId: "vend2", status: "contactado" });
    await set(p("customers/c1"), { name: "Cliente de vend1", ownerId: "vend1" });
    await set(p("orders/o1"), { sellerId: "vend1", driverId: "rep1" });
    await set(p("tasks/t1"), { assigneeId: "vend1" });
    await set(p("notes/n1"), { customerId: "c1", text: "nota" });
    await set(p("activities/a1"), { customerId: "c1" });
    await set(p("auditLogs/a1"), { action: "auth.login" });
    await set(p("settings/permissions"), { overrides: {} });
    await set(p("secrets/whatsapp"), { accessToken: "cifrado" });
    await set(p("outbox/x1"), { status: "pendiente" });
    await set(p("whatsappAccounts/principal"), { displayPhone: "+54 351" });
    await set(p("notifications/n1"), { userId: "vend1", read: false, title: "Hola" });
    await set(p("notifications/n2"), { userId: "vend2", read: false, title: "Hola" });
    await set(p("conversations/x", OTHER), { assigneeId: null });
    await set("webhookEvents/e1", { status: "recibido" });
    await set("whatsappRoutes/phone_123", { orgId: ORG, accountId: "principal", kind: "phone" });
    await set("whatsappVerifyTokens/abc", { orgId: ORG, accountId: "principal" });
  });
});

describe("aislamiento y autenticación", () => {
  test("sin sesión no se lee nada", async () => {
    await assertFails(getDoc(doc(anon(), p("conversations/conv1"))));
    await assertFails(getDoc(doc(anon(), p("notifications/n1"))));
  });

  test("no se lee otra organización, ni siendo admin", async () => {
    await assertSucceeds(getDoc(doc(as("adm", "admin"), p("conversations/conv1"))));
    await assertFails(getDoc(doc(as("adm", "admin"), p("conversations/x", OTHER))));
    // Un admin de la otra empresa tampoco cruza.
    await assertFails(getDoc(doc(as("adm2", "admin", OTHER), p("conversations/conv1"))));
  });

  test("un token sin claims de organización no accede", async () => {
    const db = env.authenticatedContext("adm").firestore() as unknown as Firestore;
    await assertFails(getDoc(doc(db, p("conversations/conv1"))));
  });

  test("un usuario dado de baja no lee aunque su token siga vigente", async () => {
    await assertFails(getDoc(doc(as("baja", "vendedor"), p("conversations/conv1"))));
  });
});

describe("mínimo privilegio: lo que no usa el navegador se niega", () => {
  const serverOnly = ["customers/c1", "orders/o1", "tasks/t1", "notes/n1", "activities/a1", "auditLogs/a1", "settings/permissions", "secrets/whatsapp", "outbox/x1", "whatsappAccounts/principal", "members/adm"];
  for (const path of serverOnly) {
    test(`ni el admin lee ${path} desde el navegador`, async () => {
      await assertFails(getDoc(doc(as("adm", "admin"), p(path))));
    });
  }
  test("tampoco la organización, los eventos de webhook ni el enrutamiento", async () => {
    const db = as("adm", "admin");
    await assertFails(getDoc(doc(db, `organizations/${ORG}`)));
    await assertFails(getDoc(doc(db, "webhookEvents/e1")));
    await assertFails(getDoc(doc(db, "whatsappRoutes/phone_123")));
    await assertFails(getDoc(doc(db, "whatsappVerifyTokens/abc")));
  });
});

describe("el navegador es solo lectura", () => {
  for (const path of ["conversations/conv1", "conversations/conv1/messages/nuevo", "leads/l1", "customers/c1", "members/adm", "notifications/nueva"]) {
    test(`admin no escribe ${path}`, async () => {
      await assertFails(setDoc(doc(as("adm", "admin"), p(path)), { x: 1 }));
    });
  }
  test("tampoco se borra ni se crea una organización", async () => {
    await assertFails(deleteDoc(doc(as("adm", "admin"), p("conversations/conv1"))));
    await assertFails(setDoc(doc(as("adm", "admin"), "organizations/nueva"), { name: "x" }));
    await assertFails(setDoc(doc(as("adm", "admin"), "whatsappRoutes/phone_999"), { orgId: ORG }));
  });
});

describe("bandeja: vendedor (propio)", () => {
  const db = () => as("vend1", "vendedor");

  test("lee su conversación, sus mensajes y su lead; no los ajenos", async () => {
    await assertSucceeds(getDoc(doc(db(), p("conversations/conv1"))));
    await assertFails(getDoc(doc(db(), p("conversations/conv2"))));
    await assertFails(getDoc(doc(db(), p("conversations/conv3")))); // sin asignar no es suyo
    await assertSucceeds(getDoc(doc(db(), p("conversations/conv1/messages/m1"))));
    await assertFails(getDoc(doc(db(), p("conversations/conv2/messages/m2"))));
    await assertSucceeds(getDoc(doc(db(), p("leads/l1"))));
    await assertFails(getDoc(doc(db(), p("leads/l2"))));
  });

  test("lista filtrando por sí mismo, no sin filtro", async () => {
    await assertSucceeds(getDocs(query(convs(db()), where("assigneeId", "==", "vend1"))));
    await assertFails(getDocs(query(convs(db()), where("status", "==", "en_atencion"))));
  });
});

describe("bandeja: supervisor (equipo)", () => {
  const db = () => as("sup", "supervisor");

  test("ve lo de su equipo y lo sin asignar; no lo de otros equipos", async () => {
    await assertSucceeds(getDoc(doc(db(), p("conversations/conv1"))));
    await assertSucceeds(getDoc(doc(db(), p("conversations/conv3"))));
    await assertFails(getDoc(doc(db(), p("conversations/conv2"))));
    await assertFails(getDoc(doc(db(), p("conversations/conv2/messages/m2"))));
    await assertFails(getDoc(doc(db(), p("leads/l2"))));
  });

  test("lista con la consulta de la bandeja (su equipo + sin asignar), no toda la empresa", async () => {
    // Las dos consultas que arma inboxQuery() para el supervisor (separadas: un `in` con null
    // no siempre lo valida el motor de reglas).
    await assertSucceeds(getDocs(query(convs(db()), where("assigneeId", "in", ["sup", "vend1"]))));
    await assertSucceeds(getDocs(query(convs(db()), where("assigneeId", "==", null))));
    // Regresión: sin filtro no puede listar la empresa entera (un valor por defecto en la regla lo dejaba pasar).
    await assertFails(getDocs(convs(db())));
    await assertFails(getDocs(query(convs(db()), where("status", "==", "en_atencion"))));
    await assertFails(getDocs(query(convs(db()), where("assigneeId", "in", ["vend1", "vend2"]))));
  });

  test("los leads se leen de a uno (nadie los lista desde el navegador)", async () => {
    await assertSucceeds(getDoc(doc(db(), p("leads/l1"))));
    await assertFails(getDocs(collection(db(), p("leads"))));
    await assertFails(getDocs(collection(as("adm", "admin"), p("leads"))));
  });
});

describe("bandeja: toda la empresa", () => {
  test("admin y solo lectura listan todo; el repartidor no tiene bandeja", async () => {
    await assertSucceeds(getDocs(convs(as("adm", "admin"))));
    await assertSucceeds(getDocs(convs(as("ro", "solo_lectura"))));
    await assertSucceeds(getDoc(doc(as("ro", "solo_lectura"), p("conversations/conv2/messages/m2"))));
    await assertFails(getDoc(doc(as("rep1", "repartidor"), p("conversations/conv1"))));
  });
});

describe("notificaciones", () => {
  test("cada uno lee las suyas y solo puede marcarlas como leídas", async () => {
    const db = as("vend1", "vendedor");
    await assertSucceeds(getDocs(query(collection(db, p("notifications")), where("userId", "==", "vend1"))));
    await assertFails(getDoc(doc(db, p("notifications/n2"))));
    await assertSucceeds(updateDoc(doc(db, p("notifications/n1")), { read: true }));
    await assertFails(updateDoc(doc(db, p("notifications/n1")), { read: "sí" }));
    await assertFails(updateDoc(doc(db, p("notifications/n1")), { title: "cambiada" }));
    await assertFails(updateDoc(doc(db, p("notifications/n2")), { read: true }));
    await assertFails(deleteDoc(doc(db, p("notifications/n1"))));
  });
});
