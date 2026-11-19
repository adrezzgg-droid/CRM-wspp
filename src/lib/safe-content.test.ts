import { test } from "node:test";
import assert from "node:assert/strict";
import { attachmentHeaders, safeNextPath } from "./safe-content.ts";

test("redirección después del login: solo rutas propias", () => {
  assert.equal(safeNextPath("/inbox?c=abc"), "/inbox?c=abc");
  for (const bad of ["//evil.com", "/\\evil.com", "/\\/evil.com", "https://evil.com", "evil.com", "/ok\u0000", "/a\\b", undefined, ["/x"]]) {
    assert.equal(safeNextPath(bad), undefined, String(bad));
  }
});

test("archivos: imagen/audio/video/PDF en línea; lo demás se descarga y nada se ejecuta", () => {
  assert.equal(attachmentHeaders("image/png", "a.png", false)["Content-Disposition"].startsWith("inline"), true);
  assert.equal(attachmentHeaders("audio/ogg; codecs=opus", "nota.ogg", false)["Content-Type"], "audio/ogg");
  for (const risky of ["text/html", "image/svg+xml", "application/xhtml+xml", "text/xml", "application/javascript"]) {
    const h = attachmentHeaders(risky, "x", false);
    assert.equal(h["Content-Type"], "application/octet-stream", risky);
    assert.ok(h["Content-Disposition"].startsWith("attachment"), risky);
  }
  const h = attachmentHeaders("image/png", 'a"\r\nSet-Cookie: x.png', true);
  assert.ok(h["Content-Disposition"].startsWith("attachment"));
  assert.ok(!/[\r\n]/.test(h["Content-Disposition"]), "sin inyección de encabezados");
  assert.match(h["Content-Security-Policy"], /sandbox/);
});
