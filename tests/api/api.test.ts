/**
 * Pruebas de la API de punta a punta: login real contra el emulador de Auth,
 * cookie de sesión y llamadas a los endpoints como lo haría el navegador.
 *
 * Requiere, en otras terminales:
 *   npm run emulators   ·   npm run seed:demo   ·   npm run dev
 * y después:  npm run test:api
 *
 * Modifica datos de la organización demo (se reinician con npm run seed:demo).
 */
import { before, describe, test } from "node:test";
import assert from "node:assert/strict";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const AUTH_EMULATOR = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";
const PASSWORD = process.env.DEMO_PASSWORD ?? "demo1234";

type Who = "admin" | "supervisor" | "vendedor1" | "vendedor2" | "lectura";
const EMAILS: Record<Who, string> = {
  admin: "admin@demo.test",
  supervisor: "supervisor@demo.test",
  vendedor1: "vendedor1@demo.test",
  vendedor2: "vendedor2@demo.test",
  lectura: "lectura@demo.test",
};

const cookies = {} as Record<Who, string>;
const uids = {} as Record<Who, string>;

async function login(who: Who): Promise<void> {
  const res = await fetch(
    `http://${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: EMAILS[who], password: PASSWORD, returnSecureToken: true }) },
  );
  const { idToken, localId } = (await res.json()) as { idToken: string; localId: string };
  assert.ok(idToken, `no se pudo iniciar sesión como ${who}`);
  const session = await fetch(`${BASE}/api/auth/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({ idToken }),
  });
  assert.equal(session.status, 200, `sesión de ${who}: ${await session.text()}`);
  const cookie = session.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  cookies[who] = cookie;
  uids[who] = localId;
}

/** Forma de las respuestas que usan estas pruebas. */
interface CustomerRow {
  id: string;
  name: string;
  ownerId: string | null;
  whatsappId: string;
  stage: string;
}
interface ApiData {
  items: CustomerRow[];
  customer: CustomerRow;
  contact: { id: string };
  member: { id: string };
  setupLink: string;
  details: { path: string[] }[];
  error?: string;
  conversationId: string;
  newCustomer: boolean;
  reopened: boolean;
  conversation: { id: string; status: string; assigneeId: string | null; customerId: string; unreadCount: number; awaitingReply: boolean; customerStage: string };
  message: { id: string; type: string; attachments?: { storagePath?: string }[] };
  tag: { id: string };
}

/** multipart/form-data (adjuntos y simulador). */
async function upload(who: Who, path: string, fields: Record<string, string>, file?: { name: string; type: string; bytes: Uint8Array }) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  if (file) form.set("file", new File([new Uint8Array(file.bytes)], file.name, { type: file.type }));
  const res = await fetch(`${BASE}${path}`, { method: "POST", headers: { Cookie: cookies[who], Origin: BASE }, body: form });
  return { status: res.status, data: (await res.json().catch(() => ({}))) as ApiData };
}

// PNG 1x1 válido.
const PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"));

async function call(who: Who, method: string, path: string, body?: unknown, origin: string | null = BASE) {
  const headers: Record<string, string> = { Cookie: cookies[who] };
  if (origin) headers.Origin = origin;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as ApiData;
  return { status: res.status, data };
}

const randomPhone = () => `351 ${600 + Math.floor(Math.random() * 300)} ${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`;

before(async () => {
  const ping = await fetch(`${BASE}/login`).catch(() => null);
  assert.ok(ping?.ok, `No responde ${BASE}. Levantá emuladores, seed y npm run dev.`);
  for (const who of Object.keys(EMAILS) as Who[]) await login(who);
});

describe("clientes: alcance por rol", () => {
  test("el vendedor solo lista sus clientes", async () => {
    const { status, data } = await call("vendedor1", "GET", "/api/customers");
    assert.equal(status, 200);
    assert.ok(data.items.length > 0);
    for (const c of data.items) assert.equal(c.ownerId, uids.vendedor1);
  });

  test("un cliente de otro vendedor responde 404 (no revela que existe)", async () => {
    const own = await call("vendedor2", "GET", "/api/customers");
    const foreignId = own.data.items[0].id;
    assert.equal((await call("vendedor1", "GET", `/api/customers/${foreignId}`)).status, 404);
    assert.equal((await call("vendedor1", "PATCH", `/api/customers/${foreignId}`, { stage: "cliente_perdido" })).status, 404);
  });

  test("el supervisor ve los sin asignar; el vendedor no", async () => {
    const sup = await call("supervisor", "GET", "/api/customers?owner=none");
    assert.ok(sup.data.items.length > 0);
    for (const c of sup.data.items) assert.equal(c.ownerId, null);
    assert.equal((await call("vendedor1", "GET", "/api/customers?owner=none")).data.items.length, 0);
  });

  test("búsqueda por nombre sin acentos y por teléfono", async () => {
    const byName = await call("admin", "GET", "/api/customers?q=polleria");
    assert.ok(byName.data.items.some((c) => c.name === "José Fernández"));
    const byPhone = await call("admin", "GET", "/api/customers?q=5551234");
    assert.ok(byPhone.data.items.some((c) => c.name === "José Fernández"));
  });
});

describe("clientes: alta, edición, baja", () => {
  let createdId = "";
  const phone = randomPhone();

  test("el vendedor crea para sí y no puede asignar a otro", async () => {
    const forbidden = await call("vendedor1", "POST", "/api/customers", { name: "Prueba asignación", ownerId: uids.vendedor2 });
    assert.equal(forbidden.status, 403);
    const ok = await call("vendedor1", "POST", "/api/customers", { name: "Cliente de prueba API", whatsapp: phone, note: "Llegó por la API" });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.equal(ok.data.customer.ownerId, uids.vendedor1);
    assert.match(ok.data.customer.whatsappId, /^549351\d{7}$/);
    createdId = ok.data.customer.id;
  });

  test("no se repite un WhatsApp", async () => {
    const dup = await call("admin", "POST", "/api/customers", { name: "Duplicado", whatsapp: phone });
    assert.equal(dup.status, 409);
  });

  test("validación de datos (422) con errores por campo", async () => {
    const bad = await call("vendedor1", "POST", "/api/customers", { name: "X", email: "no-es-email" });
    assert.equal(bad.status, 422);
    const fields = bad.data.details.map((d) => d.path[0]);
    assert.ok(fields.includes("name") && fields.includes("email"));
  });

  test("el vendedor edita su cliente pero no lo da de baja", async () => {
    const upd = await call("vendedor1", "PATCH", `/api/customers/${createdId}`, { stage: "cliente_nuevo", company: "Comercio Prueba" });
    assert.equal(upd.status, 200);
    assert.equal(upd.data.customer.stage, "cliente_nuevo");
    assert.equal((await call("vendedor1", "POST", `/api/customers/${createdId}/archive`, { archived: true })).status, 403);
  });

  test("solo lectura no crea ni anota", async () => {
    assert.equal((await call("lectura", "POST", "/api/customers", { name: "No debería" })).status, 403);
    assert.equal((await call("lectura", "POST", `/api/customers/${createdId}/notes`, { text: "hola" })).status, 403);
  });

  test("el admin da de baja y restaura; dado de baja no se edita", async () => {
    assert.equal((await call("admin", "POST", `/api/customers/${createdId}/archive`, { archived: true })).status, 200);
    assert.equal((await call("admin", "PATCH", `/api/customers/${createdId}`, { name: "Otro" })).status, 409);
    const archived = await call("admin", "GET", "/api/customers?archivados=1");
    assert.ok(archived.data.items.some((c) => c.id === createdId));
    assert.equal((await call("admin", "POST", `/api/customers/${createdId}/archive`, { archived: false })).status, 200);
  });

  test("contactos: alta, edición y borrado", async () => {
    const add = await call("vendedor1", "POST", `/api/customers/${createdId}/contacts`, { name: "Encargado", phone: "351 111 2222" });
    assert.equal(add.status, 200);
    const cid = add.data.contact.id;
    assert.equal((await call("vendedor1", "PATCH", `/api/customers/${createdId}/contacts/${cid}`, { name: "Encargado turno tarde" })).status, 200);
    assert.equal((await call("vendedor2", "DELETE", `/api/customers/${createdId}/contacts/${cid}`)).status, 404);
    assert.equal((await call("vendedor1", "DELETE", `/api/customers/${createdId}/contacts/${cid}`)).status, 200);
  });
});

describe("usuarios y permisos", () => {
  test("nadie se cambia el rol ni se da de baja a sí mismo", async () => {
    assert.equal((await call("admin", "PATCH", `/api/members/${uids.admin}`, { role: "vendedor" })).status, 409);
    assert.equal((await call("admin", "POST", `/api/members/${uids.admin}/status`, { active: false })).status, 409);
  });

  test("solo el admin administra usuarios", async () => {
    assert.equal((await call("supervisor", "POST", "/api/members", { email: "x@demo.test", displayName: "X Y", role: "admin" })).status, 403);
    assert.equal((await call("vendedor1", "PATCH", `/api/members/${uids.vendedor2}`, { displayName: "Hack" })).status, 403);
  });

  test("alta de usuario con enlace de acceso, baja y reactivación", async () => {
    const email = `nuevo${Date.now()}@demo.test`;
    const created = await call("admin", "POST", "/api/members", { email, displayName: "Usuario Nuevo", role: "vendedor" });
    assert.equal(created.status, 200, JSON.stringify(created.data));
    assert.match(created.data.setupLink, /^https?:\/\//);
    const uid = created.data.member.id;
    assert.equal((await call("admin", "POST", "/api/members", { email, displayName: "Otra vez", role: "vendedor" })).status, 409);
    assert.equal((await call("admin", "POST", `/api/members/${uid}/status`, { active: false })).status, 200);
    assert.equal((await call("admin", "POST", `/api/members/${uid}/status`, { active: true })).status, 200);
    // Se deja dado de baja para no ensuciar el demo (npm run seed:demo lo elimina).
    assert.equal((await call("admin", "POST", `/api/members/${uid}/status`, { active: false })).status, 200);
  });

  test("la empresa puede quitarle a los vendedores la edición de clientes", async () => {
    const own = (await call("vendedor1", "GET", "/api/customers")).data.items[0];
    const restricted = { overrides: { vendedor: { clientes: { actions: ["ver", "crear"], scope: "propio" } } } };
    assert.equal((await call("supervisor", "PUT", "/api/settings/permissions", restricted)).status, 403);
    assert.equal((await call("admin", "PUT", "/api/settings/permissions", restricted)).status, 200);
    try {
      assert.equal((await call("vendedor1", "PATCH", `/api/customers/${own.id}`, { industry: "Cambio" })).status, 403);
      assert.equal((await call("vendedor1", "POST", "/api/customers", { name: "Puede crear igual" })).status, 200);
    } finally {
      assert.equal((await call("admin", "PUT", "/api/settings/permissions", { overrides: {} })).status, 200);
    }
  });
});

describe("bandeja", () => {
  const phone = randomPhone();
  let convId = "";

  test("un número nuevo entra como lead sin asignar (simulador → tubería real)", async () => {
    const r = await upload("admin", "/api/demo/inbound", { phone, name: "Lead de Prueba", text: "Hola, ¿precios?" });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.newCustomer, true);
    convId = r.data.conversationId;
    const c = await call("admin", "GET", `/api/conversations/${convId}`);
    assert.equal(c.data.conversation.status, "nueva");
    assert.equal(c.data.conversation.assigneeId, null);
    assert.equal(c.data.conversation.customerStage, "prospecto");
    assert.equal(c.data.conversation.awaitingReply, true);
  });

  test("el vendedor no ve ni responde conversaciones que no son suyas", async () => {
    assert.equal((await call("vendedor1", "GET", `/api/conversations/${convId}`)).status, 404);
    assert.equal((await call("vendedor1", "POST", `/api/conversations/${convId}/messages`, { text: "hola" })).status, 404);
  });

  test("asignar: solo quien tiene permiso; el cliente sin dueño pasa al vendedor", async () => {
    assert.equal((await call("vendedor1", "POST", `/api/conversations/${convId}/assign`, { assigneeId: uids.vendedor1 })).status, 403);
    assert.equal((await call("admin", "POST", `/api/conversations/${convId}/assign`, { assigneeId: uids.lectura })).status, 422);
    assert.equal((await call("admin", "POST", `/api/conversations/${convId}/assign`, { assigneeId: uids.vendedor1 })).status, 200);
    const c = await call("vendedor1", "GET", `/api/conversations/${convId}`);
    assert.equal(c.status, 200);
    assert.equal((await call("vendedor1", "GET", `/api/customers/${c.data.conversation.customerId}`)).data.customer.ownerId, uids.vendedor1);
  });

  test("responder deja la conversación en atención; la nota interna no cambia nada", async () => {
    assert.equal((await call("vendedor1", "POST", `/api/conversations/${convId}/messages`, { text: "Interna", note: true })).status, 200);
    let c = (await call("vendedor1", "GET", `/api/conversations/${convId}`)).data.conversation;
    assert.equal(c.awaitingReply, true);
    const sent = await call("vendedor1", "POST", `/api/conversations/${convId}/messages`, { text: "¡Hola! Te paso la lista." });
    assert.equal(sent.status, 200);
    assert.match(sent.data.message.id, /^wamid.demo./);
    c = (await call("vendedor1", "GET", `/api/conversations/${convId}`)).data.conversation;
    assert.equal(c.status, "en_atencion");
    assert.equal(c.awaitingReply, false);
    assert.equal(c.unreadCount, 0);
  });

  test("solo lectura no responde ni anota", async () => {
    assert.equal((await call("lectura", "POST", `/api/conversations/${convId}/messages`, { text: "x" })).status, 403);
    assert.equal((await call("lectura", "POST", `/api/conversations/${convId}/messages`, { text: "x", note: true })).status, 403);
  });

  test("adjuntos: se envían, se sirven solo a quien corresponde y se validan", async () => {
    const r = await upload("vendedor1", `/api/conversations/${convId}/attachments`, { caption: "Lista" }, { name: "foto.png", type: "image/png", bytes: PNG });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.message.type, "image");
    const mediaPath = `/api/conversations/${convId}/messages/${encodeURIComponent(r.data.message.id)}/media?i=0`;
    const ok = await fetch(`${BASE}${mediaPath}`, { headers: { Cookie: cookies.vendedor1 } });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("content-type"), "image/png");
    assert.equal((await ok.arrayBuffer()).byteLength, PNG.byteLength);
    assert.equal((await fetch(`${BASE}${mediaPath}`, { headers: { Cookie: cookies.vendedor2 } })).status, 404);
    const bad = await upload("vendedor1", `/api/conversations/${convId}/attachments`, {}, { name: "x.html", type: "text/html", bytes: new Uint8Array([60]) });
    assert.equal(bad.status, 415);
  });

  test("cerrar y que el cliente vuelva a escribir la reabre", async () => {
    assert.equal((await call("vendedor1", "PATCH", `/api/conversations/${convId}`, { status: "cerrada" })).status, 200);
    const again = await upload("admin", "/api/demo/inbound", { phone, text: "Una consulta más" });
    assert.equal(again.data.reopened, true);
    const c = (await call("vendedor1", "GET", `/api/conversations/${convId}`)).data.conversation;
    assert.equal(c.status, "pendiente");
    assert.equal(c.assigneeId, uids.vendedor1);
  });

  test("etiquetas: el admin las administra; nombres únicos", async () => {
    const name = `PRUEBA${Date.now()}`;
    assert.equal((await call("vendedor1", "POST", "/api/tags", { name, color: "#123456" })).status, 403);
    const created = await call("admin", "POST", "/api/tags", { name, color: "#123456" });
    assert.equal(created.status, 200);
    assert.equal((await call("admin", "POST", "/api/tags", { name: name.toLowerCase(), color: "#654321" })).status, 409);
    assert.equal((await call("vendedor1", "PATCH", `/api/conversations/${convId}`, { tagIds: [created.data.tag.id] })).status, 200);
    assert.equal((await call("admin", "DELETE", `/api/tags/${created.data.tag.id}`)).status, 200);
  });
});

describe("seguridad de la API", () => {
  test("sin Origin o con otro origen, las escrituras se rechazan (CSRF)", async () => {
    assert.equal((await call("admin", "POST", "/api/customers", { name: "CSRF" }, null)).status, 403);
    assert.equal((await call("admin", "POST", "/api/customers", { name: "CSRF" }, "https://malicioso.com")).status, 403);
  });

  test("sin sesión: 401", async () => {
    const res = await fetch(`${BASE}/api/customers`);
    assert.equal(res.status, 401);
  });
});
