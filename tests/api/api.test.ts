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
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const AUTH_EMULATOR = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";
const PASSWORD = process.env.DEMO_PASSWORD ?? "demo1234";

type Who = "admin" | "supervisor" | "vendedor1" | "vendedor2" | "lectura" | "repartidor";
const EMAILS: Record<Who, string> = {
  admin: "admin@demo.test",
  supervisor: "supervisor@demo.test",
  vendedor1: "vendedor1@demo.test",
  vendedor2: "vendedor2@demo.test",
  lectura: "lectura@demo.test",
  repartidor: "repartidor@demo.test",
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
  items: (CustomerRow & { number?: string; driverId?: string })[];
  customer: CustomerRow;
  contact: { id: string };
  member: { id: string };
  setupLink: string;
  details: { path: string[] }[];
  error?: string;
  conversationId: string;
  assigneeId: string | null;
  assignmentReason?: string;
  enabled: boolean;
  alerted: number;
  lead: { id: string; status: string };
  zone: { id: string };
  product: { id: string };
  opportunity: { id: string; ownerId: string; stageId: string; probability: number; closedAt?: number };
  order: { id: string; number: string; total: number; status: string; sellerId: string; counted: boolean };
  nextCursor: string | null;
  newCustomer: boolean;
  reopened: boolean;
  conversation: { id: string; status: string; assigneeId: string | null; teamId?: string; customerId: string; unreadCount: number; awaitingReply: boolean; customerStage: string; leadId?: string };
  message: { id: string; type: string; attachments?: { storagePath?: string }[] };
  runs: unknown[];
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

const ASSIGNMENT_ON = { autoAssign: true, useZones: true, zoneFallback: true, slaEnabled: true, slaMinutes: 15 };

describe("bandeja", () => {
  const phone = randomPhone();
  let convId = "";

  before(async () => {
    // Para probar la asignación manual, sin reglas automáticas.
    assert.equal((await call("admin", "PUT", "/api/settings/assignment", { ...ASSIGNMENT_ON, autoAssign: false })).status, 200);
  });

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

describe("asignación automática, zonas y leads", () => {
  after(async () => {
    await call("admin", "PUT", "/api/settings/assignment", ASSIGNMENT_ON);
  });

  test("solo quien configura cambia las reglas; valida minutos", async () => {
    assert.equal((await call("vendedor1", "PUT", "/api/settings/assignment", ASSIGNMENT_ON)).status, 403);
    assert.equal((await call("admin", "PUT", "/api/settings/assignment", { ...ASSIGNMENT_ON, slaMinutes: 0 })).status, 422);
    assert.equal((await call("admin", "PUT", "/api/settings/assignment", ASSIGNMENT_ON)).status, 200);
  });

  test("con reglas activas, un lead nuevo se asigna solo a un vendedor disponible", async () => {
    const r = await upload("admin", "/api/demo/inbound", { phone: randomPhone(), name: "Lead Automático", text: "Hola" });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.ok([uids.vendedor1, uids.vendedor2].includes(r.data.assigneeId!), "asignado a un vendedor");
    assert.equal(r.data.assignmentReason, "regla_nuevo");
    const conv = (await call("admin", "GET", `/api/conversations/${r.data.conversationId}`)).data.conversation;
    assert.equal((await call("admin", "GET", `/api/customers/${conv.customerId}`)).data.customer.ownerId, r.data.assigneeId);
  });

  test("disponibilidad: el vendedor se saca de la rotación; solo lectura no tiene", async () => {
    assert.equal((await call("vendedor2", "POST", "/api/me/availability", { available: false })).status, 200);
    try {
      for (let i = 0; i < 2; i++) {
        const r = await upload("admin", "/api/demo/inbound", { phone: randomPhone(), text: "Hola" });
        assert.equal(r.data.assigneeId, uids.vendedor1, "solo queda vendedor1 disponible");
      }
    } finally {
      assert.equal((await call("vendedor2", "POST", "/api/me/availability", { available: true })).status, 200);
    }
    assert.equal((await call("lectura", "POST", "/api/me/availability", { available: true })).status, 403);
  });

  test("zonas: ABM con vendedores; no se borra una zona con clientes", async () => {
    const name = `Zona ${Date.now()}`;
    assert.equal((await call("vendedor1", "POST", "/api/zones", { name })).status, 403);
    const z = await call("admin", "POST", "/api/zones", { name, localities: ["Barrio X"], sellerIds: [uids.vendedor2] });
    assert.equal(z.status, 200);
    assert.equal((await call("admin", "POST", "/api/zones", { name: name.toUpperCase() })).status, 409);
    // Un cliente con esa zona y sin dueño va al vendedor que la cubre aunque no sea su turno.
    const phone = randomPhone();
    const created = await call("admin", "POST", "/api/customers", { name: "Cliente de zona", whatsapp: phone, zoneId: z.data.zone.id, ownerId: null });
    assert.equal(created.status, 200, JSON.stringify(created.data));
    const r = await upload("admin", "/api/demo/inbound", { phone, text: "Hola" });
    assert.equal(r.data.assigneeId, uids.vendedor2);
    assert.equal(r.data.assignmentReason, "regla_zona");
    assert.equal((await call("admin", "DELETE", `/api/zones/${z.data.zone.id}`)).status, 409);
    const empty = await call("admin", "POST", "/api/zones", { name: `${name} B` });
    assert.equal((await call("admin", "DELETE", `/api/zones/${empty.data.zone.id}`)).status, 200);
  });

  test("recorrido del lead: el responsable lo avanza; una venta convierte al prospecto", async () => {
    await call("admin", "PUT", "/api/settings/assignment", { ...ASSIGNMENT_ON, autoAssign: false });
    const r = await upload("admin", "/api/demo/inbound", { phone: randomPhone(), name: "Lead Venta", text: "Quiero comprar" });
    await call("admin", "POST", `/api/conversations/${r.data.conversationId}/assign`, { assigneeId: uids.vendedor1 });
    const conv = (await call("vendedor1", "GET", `/api/conversations/${r.data.conversationId}`)).data.conversation;
    assert.ok(conv.leadId);
    assert.equal((await call("vendedor2", "PATCH", `/api/leads/${conv.leadId}`, { status: "en_negociacion" })).status, 404);
    assert.equal((await call("vendedor1", "PATCH", `/api/leads/${conv.leadId}`, { status: "perdido" })).status, 422);
    const neg = await call("vendedor1", "PATCH", `/api/leads/${conv.leadId}`, { status: "en_negociacion" });
    assert.equal(neg.status, 200);
    assert.equal(neg.data.lead.status, "en_negociacion");
    assert.equal((await call("vendedor1", "PATCH", `/api/leads/${conv.leadId}`, { status: "venta_realizada" })).status, 200);
    assert.equal((await call("vendedor1", "GET", `/api/customers/${conv.customerId}`)).data.customer.stage, "cliente_nuevo");
    assert.equal((await call("vendedor1", "GET", `/api/conversations/${conv.id}`)).data.conversation.customerStage, "cliente_nuevo");
  });

  test("asignar a un equipo", async () => {
    const r = await upload("admin", "/api/demo/inbound", { phone: randomPhone(), text: "Hola" });
    assert.equal((await call("admin", "POST", `/api/conversations/${r.data.conversationId}/assign`, { teamId: "comercial" })).status, 200);
    const conv = (await call("admin", "GET", `/api/conversations/${r.data.conversationId}`)).data.conversation;
    assert.equal(conv.teamId, "comercial");
    assert.equal(conv.assigneeId, null);
    assert.equal((await call("admin", "POST", `/api/conversations/${r.data.conversationId}/assign`, { teamId: "no-existe" })).status, 422);
  });

  test("revisión de demoras: a pedido y por tarea programada con secreto", async () => {
    const run = await call("admin", "POST", "/api/assignment/sla");
    assert.equal(run.status, 200);
    assert.equal(typeof run.data.alerted, "number");
    assert.equal((await call("vendedor1", "POST", "/api/assignment/sla")).status, 403);
    assert.equal((await fetch(`${BASE}/api/cron/sla`)).status, 401);
    assert.equal((await fetch(`${BASE}/api/cron/sla`, { headers: { Authorization: "Bearer cualquiera" } })).status, 401);
  });
});

describe("productos, pipeline y pedidos", () => {
  let productA = "";
  let productB = "";
  let ownCustomer = "";
  type Stats = { stats: { ordersCount: number; totalPurchased: number } };

  before(async () => {
    ownCustomer = (await call("vendedor1", "GET", "/api/customers")).data.items[0].id;
  });

  test("productos: solo el admin los carga; códigos únicos", async () => {
    const sku = `T${Date.now()}`;
    assert.equal((await call("vendedor1", "POST", "/api/products", { name: "No", unit: "kg", price: 1 })).status, 403);
    const a = await call("admin", "POST", "/api/products", { name: "Producto A", sku, unit: "kg", price: 1000.5 });
    assert.equal(a.status, 200);
    productA = a.data.product.id;
    assert.equal((await call("admin", "POST", "/api/products", { name: "Otro", sku: sku.toLowerCase(), unit: "kg", price: 1 })).status, 409);
    productB = (await call("admin", "POST", "/api/products", { name: "Producto B", unit: "caja", price: 250 })).data.product.id;
    const list = await call("vendedor1", "GET", "/api/products?q=producto");
    assert.ok(list.data.items.some((p) => p.id === productA));
  });

  test("oportunidades: el vendedor crea para sí y no ve las ajenas", async () => {
    assert.equal((await call("vendedor1", "POST", "/api/opportunities", { customerId: ownCustomer, ownerId: uids.vendedor2 })).status, 403);
    const o = await call("vendedor1", "POST", "/api/opportunities", { customerId: ownCustomer, estimatedValue: 50000, product: "Prueba" });
    assert.equal(o.status, 200, JSON.stringify(o.data));
    assert.equal(o.data.opportunity.ownerId, uids.vendedor1);
    assert.equal(o.data.opportunity.stageId, "nuevo_lead");
    const id = o.data.opportunity.id;
    assert.equal((await call("vendedor2", "GET", `/api/opportunities/${id}`)).status, 404);
    const moved = await call("vendedor1", "PATCH", `/api/opportunities/${id}`, { stageId: "cotizacion" });
    assert.equal(moved.data.opportunity.probability, 50, "toma la probabilidad de la etapa");
    assert.equal((await call("vendedor1", "PATCH", `/api/opportunities/${id}`, { stageId: "perdido" })).status, 422);
    const lost = await call("vendedor1", "PATCH", `/api/opportunities/${id}`, { stageId: "perdido", lostReason: "Precio" });
    assert.equal(lost.status, 200);
    assert.ok(lost.data.opportunity.closedAt);
    const mine = await call("vendedor1", "GET", "/api/opportunities");
    for (const x of mine.data.items) assert.equal(x.ownerId, uids.vendedor1);
  });

  test("pedido: numeración, total, estadísticas del cliente y alcance", async () => {
    const before = (await call("vendedor1", "GET", `/api/customers/${ownCustomer}`)).data.customer as unknown as Stats;
    const r = await call("vendedor1", "POST", "/api/orders", {
      customerId: ownCustomer,
      items: [
        { productId: productA, qty: 2 },
        { productId: productB, qty: 3, unitPrice: 200 },
      ],
      confirm: true,
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.match(r.data.order.number, /^P-\d{6}$/);
    assert.equal(r.data.order.total, 2601);
    assert.equal(r.data.order.status, "confirmado");
    const after = (await call("vendedor1", "GET", `/api/customers/${ownCustomer}`)).data.customer as unknown as Stats;
    assert.equal(after.stats.ordersCount, before.stats.ordersCount + 1);
    assert.equal(after.stats.totalPurchased, before.stats.totalPurchased + 2601);
    const r2 = await call("vendedor1", "POST", "/api/orders", { customerId: ownCustomer, items: [{ productId: productB, qty: 1 }] });
    assert.equal(r2.data.order.status, "borrador");
    assert.equal(Number(r2.data.order.number.slice(2)), Number(r.data.order.number.slice(2)) + 1, "correlativo");
    assert.equal((await call("vendedor2", "GET", `/api/orders/${r.data.order.id}`)).status, 404);
    assert.equal((await call("vendedor1", "POST", "/api/orders", { customerId: ownCustomer, items: [{ productId: "no-existe", qty: 1 }] })).status, 422);
    assert.equal((await call("repartidor", "POST", "/api/orders", { customerId: ownCustomer, items: [{ productId: productA, qty: 1 }] })).status, 403);
  });

  test("circuito de entrega: cada rol mueve lo suyo", async () => {
    const id = (await call("vendedor1", "POST", "/api/orders", { customerId: ownCustomer, items: [{ productId: productA, qty: 1 }], confirm: true })).data.order.id;
    assert.equal((await call("vendedor1", "POST", `/api/orders/${id}/status`, { status: "en_preparacion" })).status, 409, "el vendedor no despacha");
    assert.equal((await call("repartidor", "GET", `/api/orders/${id}`)).status, 404, "el repartidor no lo ve hasta que se lo asignan");
    assert.equal((await call("vendedor1", "POST", `/api/orders/${id}/driver`, { driverId: uids.repartidor })).status, 403);
    assert.equal((await call("admin", "POST", `/api/orders/${id}/driver`, { driverId: uids.vendedor2 })).status, 422);
    assert.equal((await call("admin", "POST", `/api/orders/${id}/driver`, { driverId: uids.repartidor })).status, 200);
    const list = await call("repartidor", "GET", "/api/orders");
    assert.ok(list.data.items.some((o) => o.id === id));
    for (const o of list.data.items) assert.equal(o.driverId, uids.repartidor);
    assert.equal((await call("repartidor", "POST", `/api/orders/${id}/status`, { status: "en_reparto" })).status, 409, "primero se prepara");
    assert.equal((await call("admin", "POST", `/api/orders/${id}/status`, { status: "en_preparacion" })).status, 200);
    assert.equal((await call("repartidor", "POST", `/api/orders/${id}/status`, { status: "en_reparto" })).status, 200);
    assert.equal((await call("repartidor", "POST", `/api/orders/${id}/status`, { status: "entregado" })).status, 200);
    assert.equal((await call("admin", "POST", `/api/orders/${id}/status`, { status: "cancelado", reason: "x" })).status, 409, "un entregado no se cancela");
  });

  test("cancelar descuenta de las compras y pide motivo", async () => {
    const count = async () => ((await call("vendedor1", "GET", `/api/customers/${ownCustomer}`)).data.customer as unknown as Stats).stats.ordersCount;
    const id = (await call("vendedor1", "POST", "/api/orders", { customerId: ownCustomer, items: [{ productId: productB, qty: 2 }], confirm: true })).data.order.id;
    const withOrder = await count();
    assert.equal((await call("vendedor1", "POST", `/api/orders/${id}/status`, { status: "cancelado" })).status, 422);
    assert.equal((await call("vendedor1", "POST", `/api/orders/${id}/status`, { status: "cancelado", reason: "Sin stock" })).status, 200);
    assert.equal(await count(), withOrder - 1);
  });

  test("el primer pedido de un lead lo convierte en cliente", async () => {
    await call("admin", "PUT", "/api/settings/assignment", { ...ASSIGNMENT_ON, autoAssign: false });
    try {
      const sim = await upload("admin", "/api/demo/inbound", { phone: randomPhone(), name: "Lead Pedido", text: "Quiero comprar" });
      await call("admin", "POST", `/api/conversations/${sim.data.conversationId}/assign`, { assigneeId: uids.vendedor1 });
      const conv = (await call("vendedor1", "GET", `/api/conversations/${sim.data.conversationId}`)).data.conversation;
      const r = await call("vendedor1", "POST", "/api/orders", {
        customerId: conv.customerId,
        items: [{ productId: productA, qty: 1 }],
        confirm: true,
        conversationId: conv.id,
        leadId: conv.leadId,
      });
      assert.equal(r.status, 200, JSON.stringify(r.data));
      assert.ok(["cliente_nuevo", "cliente_activo"].includes((await call("vendedor1", "GET", `/api/customers/${conv.customerId}`)).data.customer.stage), "deja de ser prospecto (la automatización del demo lo pasa a activo)");
    } finally {
      await call("admin", "PUT", "/api/settings/assignment", ASSIGNMENT_ON);
    }
  });
});

describe("tareas y Mi día", () => {
  let ownCustomer = "";
  const pad = (n: number) => String(n).padStart(2, "0");
  // Fechas en la zona de la empresa demo (UTC-3).
  const dayIn = (offset: number) => {
    const d = new Date(Date.now() - 3 * 3_600_000 + offset * 86_400_000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  };
  type TaskRow = { id: string; status: string; assigneeId: string; outcome?: string };
  const tasksOf = async (who: Who, vista: string) => (await call(who, "GET", `/api/tasks?vista=${vista}`)).data as unknown as { items: TaskRow[]; counts: Record<string, number> };

  before(async () => {
    ownCustomer = (await call("vendedor1", "GET", "/api/customers")).data.items[0].id;
  });

  test("el vendedor crea tareas para sí; no puede asignar a otro", async () => {
    assert.equal((await call("vendedor1", "POST", "/api/tasks", { type: "llamada", dueDate: dayIn(0), assigneeId: uids.vendedor2 })).status, 403);
    const r = await call("vendedor1", "POST", "/api/tasks", { type: "llamada", dueDate: dayIn(0), dueTime: "23:58", customerId: ownCustomer, description: "Prueba hoy" });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const t = (r.data as unknown as { task: TaskRow }).task;
    assert.equal(t.assigneeId, uids.vendedor1);
    const hoy = await tasksOf("vendedor1", "hoy");
    assert.ok(hoy.items.some((x) => x.id === t.id));
    assert.equal(hoy.counts.hoy, hoy.items.length);
    assert.equal((await call("vendedor2", "GET", `/api/tasks/${t.id}`)).status, 404);
  });

  test("vistas: vencidas y próximas según la fecha de la empresa", async () => {
    const old = (await call("vendedor1", "POST", "/api/tasks", { type: "visita", dueDate: dayIn(-3) })).data as unknown as { task: TaskRow };
    const next = (await call("vendedor1", "POST", "/api/tasks", { type: "seguimiento", dueDate: dayIn(3) })).data as unknown as { task: TaskRow };
    assert.ok((await tasksOf("vendedor1", "vencidas")).items.some((x) => x.id === old.task.id));
    assert.ok((await tasksOf("vendedor1", "proximas")).items.some((x) => x.id === next.task.id));
    // Reprogramar mueve de vista.
    assert.equal((await call("vendedor1", "PATCH", `/api/tasks/${old.task.id}`, { dueDate: dayIn(4) })).status, 200);
    assert.ok((await tasksOf("vendedor1", "proximas")).items.some((x) => x.id === old.task.id));
  });

  test("completar con resultado lo deja en el historial del cliente; se puede reabrir", async () => {
    const t = ((await call("vendedor1", "POST", "/api/tasks", { type: "llamada", dueDate: dayIn(0), customerId: ownCustomer })).data as unknown as { task: TaskRow }).task;
    const done = await call("vendedor1", "POST", `/api/tasks/${t.id}/status`, { status: "completada", outcome: "Pidió lista nueva" });
    assert.equal(done.status, 200);
    assert.ok((await tasksOf("vendedor1", "completadas")).items.some((x) => x.id === t.id && x.outcome === "Pidió lista nueva"));
    assert.equal((await call("vendedor1", "PATCH", `/api/tasks/${t.id}`, { description: "x" })).status, 409, "una completada no se edita");
    assert.equal((await call("vendedor1", "POST", `/api/tasks/${t.id}/status`, { status: "pendiente" })).status, 200);
  });

  test("el supervisor asigna tareas a su equipo; el repartidor no crea", async () => {
    const r = await call("supervisor", "POST", "/api/tasks", { type: "visita", dueDate: dayIn(1), assigneeId: uids.vendedor1, description: "Visitar con el supervisor" });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const id = (r.data as unknown as { task: TaskRow }).task.id;
    assert.equal((await call("vendedor1", "GET", `/api/tasks/${id}`)).status, 200);
    assert.equal((await call("supervisor", "POST", "/api/tasks", { type: "visita", dueDate: dayIn(1), assigneeId: uids.lectura })).status, 422);
    assert.equal((await call("repartidor", "POST", "/api/tasks", { type: "visita", dueDate: dayIn(1) })).status, 403);
    assert.equal((await call("lectura", "POST", "/api/tasks", { type: "visita", dueDate: dayIn(1) })).status, 403);
  });

  test("validación de fecha y hora", async () => {
    assert.equal((await call("vendedor1", "POST", "/api/tasks", { type: "llamada", dueDate: "05/10/2026" })).status, 422);
    assert.equal((await call("vendedor1", "POST", "/api/tasks", { type: "llamada", dueDate: dayIn(0), dueTime: "25:00" })).status, 422);
  });

  test("preferencias de notificación personales", async () => {
    assert.equal((await call("vendedor1", "PUT", "/api/me/notifications", { prefs: { tarea_vencida: false } })).status, 200);
    assert.equal((await call("vendedor1", "PUT", "/api/me/notifications", { prefs: { inventada: true } })).status, 422);
    assert.equal((await call("vendedor1", "PUT", "/api/me/notifications", { prefs: { tarea_vencida: true } })).status, 200);
  });

  test("Mi día responde para cada rol", async () => {
    for (const who of ["vendedor1", "repartidor", "supervisor"] as Who[]) {
      const res = await fetch(`${BASE}/mi-dia`, { headers: { Cookie: cookies[who] } });
      assert.equal(res.status, 200, who);
      assert.match(await res.text(), /Buen|Buenas/);
    }
  });
});

describe("plantillas y automatizaciones", () => {
  type Row = { id: string; metaStatus?: string; type?: string; tagIds?: string[]; lastMessageDirection?: string; awaitingReply?: boolean; stage?: string };
  const tplName = `prueba_${Date.now()}`;
  let tplId = "";

  test("plantillas: solo el admin las crea; variables y nombres válidos", async () => {
    assert.equal((await call("vendedor1", "POST", "/api/templates", { name: tplName, category: "utility", body: "Hola {{nombre}}" })).status, 403);
    assert.equal((await call("admin", "POST", "/api/templates", { name: tplName, category: "utility", body: "Hola {{apodo}}" })).status, 422);
    const r = await call("admin", "POST", "/api/templates", { name: tplName, category: "utility", body: "Hola {{nombre}}, soy {{vendedor}}" });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    tplId = (r.data as unknown as { template: Row }).template.id;
    assert.equal((r.data as unknown as { template: Row }).template.metaStatus, "borrador");
    assert.equal((await call("admin", "POST", "/api/templates", { name: tplName, category: "marketing", body: "x" })).status, 409);
    assert.equal((await call("vendedor1", "GET", "/api/templates")).status, 200, "el vendedor las consulta");
  });

  test("enviar plantilla: solo aprobadas, con todas sus variables", async () => {
    const conv = "demo_5493515551234"; // José, a cargo de vendedor1
    assert.equal((await call("vendedor1", "POST", `/api/conversations/${conv}/template`, { templateId: tplId, values: { nombre: "José", vendedor: "Juan" } })).status, 409, "borrador");
    assert.equal((await call("admin", "POST", `/api/templates/${tplId}/status`, { metaStatus: "aprobada" })).status, 200);
    assert.equal((await call("vendedor1", "POST", `/api/conversations/${conv}/template`, { templateId: tplId, values: { nombre: "José" } })).status, 422, "falta {{vendedor}}");
    const ok = await call("vendedor1", "POST", `/api/conversations/${conv}/template`, { templateId: tplId, values: { nombre: "José", vendedor: "Juan" } });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.equal(ok.data.message.type, "template");
    assert.equal((await call("vendedor2", "POST", `/api/conversations/${conv}/template`, { templateId: tplId, values: { nombre: "x", vendedor: "y" } })).status, 404);
  });

  test("escribirle a una conversación cerrada la reabre (plantilla fuera de las 24 h)", async () => {
    const conv = "demo_5493543442233"; // Pablo: cerrada y con la ventana vencida
    const r = await call("admin", "POST", `/api/conversations/${conv}/template`, { templateId: "seguimiento", values: { nombre: "Pablo", vendedor: "María" } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal((await call("admin", "GET", `/api/conversations/${conv}`)).data.conversation.status, "en_atencion");
    assert.equal((await call("admin", "POST", `/api/conversations/${conv}/messages`, { text: "texto libre" })).status, 409, "texto libre sigue bloqueado fuera de las 24 h");
  });

  test("automatizaciones: solo el admin; referencias válidas; una plantilla en uso no se borra", async () => {
    const rule = { name: "Prueba API", trigger: "pedido_creado", actions: [{ type: "enviar_mensaje", templateId: tplId }] };
    assert.equal((await call("vendedor1", "POST", "/api/automations", rule)).status, 403);
    assert.equal((await call("admin", "POST", "/api/automations", { ...rule, actions: [{ type: "agregar_etiqueta", tagId: "no-existe" }] })).status, 422);
    const created = await call("admin", "POST", "/api/automations", { ...rule, enabled: false });
    assert.equal(created.status, 200, JSON.stringify(created.data));
    const id = (created.data as unknown as { automation: Row }).automation.id;
    assert.equal((await call("admin", "DELETE", `/api/templates/${tplId}`)).status, 409);
    assert.equal((await call("admin", "POST", `/api/automations/${id}/toggle`, { enabled: true })).status, 200);
    assert.equal((await call("admin", "DELETE", `/api/automations/${id}`)).status, 200);
    assert.equal((await call("admin", "DELETE", `/api/templates/${tplId}`)).status, 200);
  });

  test("contacto nuevo: la bienvenida automática sale y no cuenta como respuesta", async () => {
    const sim = await upload("admin", "/api/demo/inbound", { phone: randomPhone(), name: "Auto Bienvenida", text: "Hola!" });
    assert.equal(sim.status, 200);
    const conv = (await call("admin", "GET", `/api/conversations/${sim.data.conversationId}`)).data.conversation as unknown as Row;
    assert.equal(conv.lastMessageDirection, "out", "se envió la bienvenida");
    assert.equal(conv.awaitingReply, true, "sigue esperando a una persona");
    assert.ok(conv.tagIds?.includes("nuevo"));
  });

  test("ejecutar ahora: marca para reactivar a quien no compra hace 30 días", async () => {
    assert.equal((await call("vendedor1", "POST", "/api/automations/run")).status, 403);
    const r = await call("admin", "POST", "/api/automations/run");
    assert.equal(r.status, 200);
    const laura = (await call("admin", "GET", "/api/customers/demo-cliente-2")).data.customer as unknown as Row & { needsReactivation: boolean };
    assert.equal(laura.needsReactivation, true);
    assert.equal(laura.stage, "cliente_inactivo");
    const runs = (await call("admin", "GET", "/api/automations")).data as unknown as { runs: { automationId: string; status: string }[] };
    assert.ok(runs.runs.some((x) => x.automationId === "reactivar-30d" && x.status === "ok"));
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
