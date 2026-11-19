import { test } from "node:test";
import assert from "node:assert/strict";
import { assertPublicDestination, checkConnectorUrl, deliver, deliveryRequest, isPrivateAddress } from "./outbox-core.ts";
import { verifySignature } from "../whatsapp/signature.ts";

test("URL del conector: https y nada interno (salvo localhost en desarrollo)", () => {
  assert.equal(checkConnectorUrl("https://gestion.midistribuidora.com/api/crm", false), null);
  assert.match(checkConnectorUrl("http://gestion.midistribuidora.com", false)!, /https/);
  for (const bad of ["https://localhost/x", "https://127.0.0.1/x", "https://10.0.0.5/x", "https://192.168.1.10/x", "https://172.20.0.1/x", "https://169.254.169.254/latest", "https://metadata.google.internal/", "https://[::1]/x", "https://user:pass@x.com/"]) {
    assert.ok(checkConnectorUrl(bad, false), bad);
  }
  assert.equal(checkConnectorUrl("http://localhost:3001/api/crm", true), null);
  assert.ok(checkConnectorUrl("no es url", true));
});

test("envío firmado: el receptor puede verificar la firma con el secreto compartido", async () => {
  const item = { id: "out-1", event: "order.confirmed", payload: { number: "P-000001", total: 1000 }, createdAt: 1 };
  const req = deliveryRequest("org-1", item, "secreto");
  assert.equal(req.headers["X-CRM-Delivery"], "out-1");
  assert.equal(verifySignature(req.body, req.headers["X-CRM-Signature"], "secreto"), true);
  assert.deepEqual(JSON.parse(req.body), { id: "out-1", event: "order.confirmed", orgId: "org-1", createdAt: 1, data: { number: "P-000001", total: 1000 } });
});

test("resultado del envío: 2xx ok, 5xx/429 se reintenta, otro 4xx es definitivo, caída de red se reintenta", async () => {
  const reply = (status: number) => (async () => new Response("detalle", { status })) as unknown as typeof fetch;
  const item = { id: "x", event: "ping", payload: {}, createdAt: 0 };
  const run = (f: typeof fetch) => deliver({ db: null as never, secretKey: null, fetch: f, resolve: async () => ["93.184.216.34"] }, "o", "https://x.test", "s", item);
  assert.deepEqual(await run(reply(200)), { ok: true, status: 200 });
  assert.equal((await run(reply(503))).permanent, false);
  assert.equal((await run(reply(429))).permanent, false);
  assert.equal((await run(reply(400))).permanent, true);
  const down = (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof fetch;
  const r = await run(down);
  assert.equal(r.ok, false);
  assert.equal(r.permanent, undefined);
  assert.match(r.error!, /No se pudo conectar/);
});

test("destino del conector: se resuelve el nombre y no se manda a IPs internas (DNS rebinding)", async () => {
  for (const ip of ["10.1.2.3", "127.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.0.10", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) assert.equal(isPrivateAddress(ip), true, ip);
  for (const ip of ["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111"]) assert.equal(isPrivateAddress(ip), false, ip);
  const deps = (addresses: string[]) => ({ db: null as never, secretKey: null, resolve: async () => addresses });
  assert.equal(await assertPublicDestination(deps(["93.184.216.34"]), "https://gestion.test/x"), null);
  assert.match((await assertPublicDestination(deps(["93.184.216.34", "10.0.0.5"]), "https://gestion.test/x"))!, /interna/);
  assert.equal(await assertPublicDestination({ ...deps(["10.0.0.5"]), allowPrivate: true }, "http://localhost:3001"), null);
  let called = false;
  const spy = (async () => {
    called = true;
    return new Response("ok");
  }) as unknown as typeof fetch;
  const r = await deliver({ ...deps(["192.168.1.1"]), fetch: spy }, "o", "https://gestion.test/x", "s", { id: "x", event: "ping", payload: {}, createdAt: 0 });
  assert.equal(r.ok, false);
  assert.equal(r.permanent, true);
  assert.equal(called, false, "no se llegó a conectar");
});
