import { test } from "node:test";
import assert from "node:assert/strict";
import { checkConnectorUrl, deliver, deliveryRequest } from "./outbox-core.ts";
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
  const run = (f: typeof fetch) => deliver({ db: null as never, secretKey: null, fetch: f }, "o", "https://x.test", "s", item);
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
