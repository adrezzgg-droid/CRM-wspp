/**
 * Pruebas de firestore.rules contra el emulador.
 *   npm run test:rules
 */
import { after, before, beforeEach, describe, test } from "node:test";
import { readFileSync } from "node:fs";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  deleteDoc,
  where,
  type Firestore,
} from "firebase/firestore";

const ORG = "org1";
const OTHER = "org2";
let env: RulesTestEnvironment;

type Role = "admin" | "supervisor" | "vendedor" | "repartidor" | "solo_lectura";

function as(uid: string, role: Role, orgId = ORG): Firestore {
  return env.authenticatedContext(uid, { orgId, role }).firestore() as unknown as Firestore;
}
const anon = () => env.unauthenticatedContext().firestore() as unknown as Firestore;
const p = (path: string, orgId = ORG) => `organizations/${orgId}/${path}`;

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
    await set(`organizations/${ORG}`, { name: "Org 1", isDemo: false });
    await set(`organizations/${OTHER}`, { name: "Org 2", isDemo: false });
    await set(p("members/vend1"), { role: "vendedor" });
    await set(p("members/vend2"), { role: "vendedor" });
    await set(p("customers/c1"), { name: "Cliente de vend1", ownerId: "vend1" });
    await set(p("customers/c2"), { name: "Cliente de vend2", ownerId: "vend2" });
    await set(p("conversations/conv1"), { assigneeId: "vend1", status: "en_atencion" });
    await set(p("conversations/conv2"), { assigneeId: "vend2", status: "en_atencion" });
    await set(p("conversations/conv1/messages/m1"), { text: "hola" });
    await set(p("conversations/conv2/messages/m2"), { text: "hola" });
    await set(p("orders/o1"), { sellerId: "vend1", driverId: "rep1", status: "en_reparto" });
    await set(p("orders/o2"), { sellerId: "vend2", driverId: "rep2", status: "en_reparto" });
    await set(p("tasks/t1"), { assigneeId: "rep1", status: "pendiente" });
    await set(p("tasks/t2"), { assigneeId: "vend1", status: "pendiente" });
    await set(p("auditLogs/a1"), { action: "auth.login" });
    await set(p("automations/au1"), { name: "Bienvenida" });
    await set(p("whatsappAccounts/w1"), { displayPhone: "+54 351" });
    await set(p("secrets/whatsapp"), { accessToken: "cifrado" });
    await set(p("outbox/x1"), { status: "pendiente" });
    await set(p("settings/permissions"), { overrides: {} });
    await set(p("notifications/n1"), { userId: "vend1", read: false, title: "Hola" });
    await set(p("notifications/n2"), { userId: "vend2", read: false, title: "Hola" });
    await set(p("customers/x", OTHER), { name: "Cliente de otra org", ownerId: "vend1" });
    await set("webhookEvents/e1", { status: "recibido" });
  });
});

describe("aislamiento y autenticación", () => {
  test("sin sesión no se lee nada", async () => {
    await assertFails(getDoc(doc(anon(), `organizations/${ORG}`)));
    await assertFails(getDoc(doc(anon(), p("customers/c1"))));
  });

  test("no se lee otra organización, ni siendo admin", async () => {
    const db = as("adm", "admin");
    await assertSucceeds(getDoc(doc(db, `organizations/${ORG}`)));
    await assertFails(getDoc(doc(db, `organizations/${OTHER}`)));
    await assertFails(getDoc(doc(db, p("customers/x", OTHER))));
  });

  test("un token sin claims de organización no accede", async () => {
    const db = env.authenticatedContext("suelto").firestore() as unknown as Firestore;
    await assertFails(getDoc(doc(db, `organizations/${ORG}`)));
  });
});

describe("el navegador es solo lectura", () => {
  const paths = [
    "customers/c1",
    "customers/nuevo",
    "conversations/conv1",
    "conversations/conv1/messages/nuevo",
    "orders/o1",
    "tasks/t1",
    "members/adm",
    "auditLogs/nuevo",
    "activities/nuevo",
    "settings/permissions",
    "whatsappAccounts/w1",
  ];
  for (const path of paths) {
    test(`admin no escribe ${path}`, async () => {
      await assertFails(setDoc(doc(as("adm", "admin"), p(path)), { x: 1 }));
    });
  }
  test("tampoco se borra", async () => {
    await assertFails(deleteDoc(doc(as("adm", "admin"), p("customers/c1"))));
    await assertFails(deleteDoc(doc(as("adm", "admin"), p("auditLogs/a1"))));
  });
  test("ni se crea una organización", async () => {
    await assertFails(setDoc(doc(as("adm", "admin"), "organizations/nueva"), { name: "x" }));
  });
});

describe("vendedor: solo lo propio", () => {
  const db = () => as("vend1", "vendedor");

  test("lee su cliente y no el de otro vendedor", async () => {
    await assertSucceeds(getDoc(doc(db(), p("customers/c1"))));
    await assertFails(getDoc(doc(db(), p("customers/c2"))));
  });

  test("puede listar filtrando por sí mismo, no sin filtro", async () => {
    await assertSucceeds(getDocs(query(collection(db(), p("customers")), where("ownerId", "==", "vend1"))));
    await assertFails(getDocs(collection(db(), p("customers"))));
    await assertSucceeds(
      getDocs(query(collection(db(), p("conversations")), where("assigneeId", "==", "vend1"))),
    );
    await assertFails(getDocs(query(collection(db(), p("conversations")), where("status", "==", "en_atencion"))));
  });

  test("los mensajes heredan el alcance de la conversación", async () => {
    await assertSucceeds(getDoc(doc(db(), p("conversations/conv1/messages/m1"))));
    await assertFails(getDoc(doc(db(), p("conversations/conv2/messages/m2"))));
  });

  test("ve sus pedidos y tareas, no los ajenos", async () => {
    await assertSucceeds(getDoc(doc(db(), p("orders/o1"))));
    await assertFails(getDoc(doc(db(), p("orders/o2"))));
    await assertSucceeds(getDoc(doc(db(), p("tasks/t2"))));
    await assertFails(getDoc(doc(db(), p("tasks/t1"))));
  });

  test("solo su propio miembro; nada de auditoría, automatizaciones ni WhatsApp", async () => {
    await assertSucceeds(getDoc(doc(db(), p("members/vend1"))));
    await assertFails(getDoc(doc(db(), p("members/vend2"))));
    await assertFails(getDoc(doc(db(), p("auditLogs/a1"))));
    await assertFails(getDoc(doc(db(), p("automations/au1"))));
    await assertFails(getDoc(doc(db(), p("whatsappAccounts/w1"))));
  });
});

describe("repartidor", () => {
  const db = () => as("rep1", "repartidor");

  test("ve los pedidos que tiene que entregar, no otros", async () => {
    await assertSucceeds(getDoc(doc(db(), p("orders/o1"))));
    await assertFails(getDoc(doc(db(), p("orders/o2"))));
    await assertSucceeds(getDocs(query(collection(db(), p("orders")), where("driverId", "==", "rep1"))));
  });

  test("ve sus tareas", async () => {
    await assertSucceeds(getDoc(doc(db(), p("tasks/t1"))));
    await assertFails(getDoc(doc(db(), p("tasks/t2"))));
  });

  test("no ve clientes, conversaciones, etiquetas ni productos", async () => {
    await assertFails(getDoc(doc(db(), p("customers/c1"))));
    await assertFails(getDoc(doc(db(), p("conversations/conv1"))));
    await assertFails(getDocs(collection(db(), p("tags"))));
    await assertFails(getDocs(collection(db(), p("products"))));
  });
});

describe("supervisor y solo lectura", () => {
  test("supervisor ve todas las conversaciones y las asignaciones", async () => {
    const db = as("sup", "supervisor");
    await assertSucceeds(getDocs(collection(db, p("conversations"))));
    await assertSucceeds(getDocs(collection(db, p("assignments"))));
    await assertFails(getDoc(doc(db, p("auditLogs/a1"))));
    await assertFails(getDoc(doc(db, p("whatsappAccounts/w1"))));
  });

  test("solo lectura consulta datos comerciales pero no administración", async () => {
    const db = as("ro", "solo_lectura");
    await assertSucceeds(getDocs(collection(db, p("customers"))));
    await assertSucceeds(getDoc(doc(db, p("conversations/conv2/messages/m2"))));
    await assertFails(getDoc(doc(db, p("auditLogs/a1"))));
    await assertFails(getDoc(doc(db, p("automations/au1"))));
    await assertFails(getDocs(collection(db, p("assignments"))));
  });
});

describe("secretos y colas internas", () => {
  test("el token de WhatsApp no se lee ni siendo admin", async () => {
    await assertFails(getDoc(doc(as("adm", "admin"), p("secrets/whatsapp"))));
  });
  test("outbox y webhookEvents son solo del servidor", async () => {
    await assertFails(getDoc(doc(as("adm", "admin"), p("outbox/x1"))));
    await assertFails(getDoc(doc(as("adm", "admin"), "webhookEvents/e1")));
  });
  test("admin lee auditoría, automatizaciones y la cuenta de WhatsApp (sin token)", async () => {
    const db = as("adm", "admin");
    await assertSucceeds(getDoc(doc(db, p("auditLogs/a1"))));
    await assertSucceeds(getDoc(doc(db, p("automations/au1"))));
    await assertSucceeds(getDoc(doc(db, p("whatsappAccounts/w1"))));
  });
});

describe("notificaciones", () => {
  test("cada uno lee solo las suyas", async () => {
    const db = as("vend1", "vendedor");
    await assertSucceeds(getDoc(doc(db, p("notifications/n1"))));
    await assertFails(getDoc(doc(db, p("notifications/n2"))));
    await assertSucceeds(
      getDocs(query(collection(db, p("notifications")), where("userId", "==", "vend1"), where("read", "==", false))),
    );
    await assertFails(getDocs(collection(db, p("notifications"))));
  });

  test("puede marcarlas como leídas y nada más", async () => {
    const db = as("vend1", "vendedor");
    await assertSucceeds(updateDoc(doc(db, p("notifications/n1")), { read: true }));
    await assertFails(updateDoc(doc(db, p("notifications/n1")), { title: "cambiado" }));
    await assertFails(updateDoc(doc(db, p("notifications/n1")), { read: "si" }));
    await assertFails(updateDoc(doc(db, p("notifications/n2")), { read: true }));
    await assertFails(setDoc(doc(db, p("notifications/n3")), { userId: "vend1", read: false }));
    await assertFails(deleteDoc(doc(db, p("notifications/n1"))));
  });
});
