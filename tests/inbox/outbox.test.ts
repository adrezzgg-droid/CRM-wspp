/**
 * Cola de envíos a otros sistemas (conector de gestión) contra el emulador.
 *   npm run test:emulador
 */
import { before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { seal } from "../../src/server/whatsapp/secret-box.ts";
import { verifySignature } from "../../src/server/whatsapp/signature.ts";
import { BACKOFF_MINUTES, integrationSecretContext, MAX_ATTEMPTS, processOutbox, type OutboxDeps } from "../../src/server/connectors/outbox-core.ts";

const app = initializeApp({ projectId: "demo-crm-whatsapp-outbox" }, "outbox-tests");
const db = getFirestore(app);
db.settings({ ignoreUndefinedProperties: true });

const ORG = "org-outbox";
const KEY = randomBytes(32);
const SECRET = "secreto-compartido";
const NOW = 1_800_000_000_000;
const org = db.collection("organizations").doc(ORG);

let replies: number[] = [];
const received: { body: string; headers: Record<string, string> }[] = [];
const receiver = (async (_url: string | URL | Request, init?: RequestInit) => {
  received.push({ body: String(init?.body), headers: init?.headers as Record<string, string> });
  const status = replies.shift() ?? 200;
  return new Response(status < 300 ? "ok" : "falló", { status });
}) as typeof fetch;

const deps: OutboxDeps = { db, secretKey: KEY, fetch: receiver, now: () => NOW };

async function item(id: string, extra: Record<string, unknown> = {}) {
  await org.collection("outbox").doc(id).set({
    id,
    orgId: ORG,
    isDemo: false,
    connector: "gestion",
    event: "order.confirmed",
    payload: { orderId: id, number: "P-000001", total: 1000 },
    status: "pendiente",
    attempts: 0,
    nextAttemptAt: NOW - 1,
    createdAt: NOW - 1000,
    ...extra,
  });
}
const read = async (id: string) => (await org.collection("outbox").doc(id).get()).data()!;

before(() => assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "Correr con npm run test:emulador"));

beforeEach(async () => {
  for (const d of (await org.collection("outbox").get()).docs) await d.ref.delete();
  await org.set({ id: ORG, name: "Outbox", isDemo: false, status: "active" });
  await org.collection("settings").doc("integrations").set({ connectors: { gestion: { enabled: true, url: "https://gestion.test/crm", events: ["order.confirmed"] } } });
  await org.collection("secrets").doc("integrations").set({ gestion: seal(SECRET, KEY, integrationSecretContext(ORG, "gestion")) });
  replies = [];
  received.length = 0;
});

describe("cola de envíos (conector de gestión)", () => {
  test("se entrega firmado y queda como enviado", async () => {
    await item("o1");
    assert.deepEqual(await processOutbox(deps, ORG), { sent: 1, retrying: 0, failed: 0 });
    const doc = await read("o1");
    assert.equal(doc.status, "enviado");
    assert.equal(doc.deliveredAt, NOW);
    const [req] = received;
    assert.equal(req.headers["X-CRM-Delivery"], "o1");
    assert.equal(verifySignature(req.body, req.headers["X-CRM-Signature"], SECRET), true, "el receptor puede verificar la firma");
    assert.equal(JSON.parse(req.body).data.number, "P-000001");
  });

  test("si el receptor falla se reintenta más tarde; un 4xx queda en error sin reintentar", async () => {
    await item("o2");
    await item("o3");
    replies = [503, 400];
    assert.deepEqual(await processOutbox(deps, ORG), { sent: 0, retrying: 1, failed: 1 });
    const retry = await read("o2");
    assert.deepEqual([retry.status, retry.attempts, retry.nextAttemptAt], ["pendiente", 1, NOW + BACKOFF_MINUTES[0] * 60_000]);
    assert.match(retry.lastError, /503/);
    assert.equal((await read("o3")).status, "error");
    // Antes de su momento no se vuelve a intentar.
    assert.deepEqual(await processOutbox(deps, ORG), { sent: 0, retrying: 0, failed: 0 });
  });

  test("después del último intento queda en error", async () => {
    await item("o4", { attempts: MAX_ATTEMPTS - 1 });
    replies = [500];
    await processOutbox(deps, ORG);
    const doc = await read("o4");
    assert.deepEqual([doc.status, doc.attempts], ["error", MAX_ATTEMPTS]);
  });

  test("con el conector apagado los envíos esperan sin gastar intentos", async () => {
    await org.collection("settings").doc("integrations").set({ connectors: { gestion: { enabled: false, url: "https://gestion.test/crm" } } });
    await item("o5");
    assert.deepEqual(await processOutbox(deps, ORG), { sent: 0, retrying: 0, failed: 0 });
    const doc = await read("o5");
    assert.deepEqual([doc.status, doc.attempts], ["pendiente", 0]);
    assert.equal(received.length, 0);
  });
});
