import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PIPELINE_STAGES, DEFAULT_TAGS, newMember, orgIdFromName } from "./defaults.ts";

test("el pipeline tiene las 9 etapas del requerimiento, en orden", () => {
  assert.deepEqual(
    DEFAULT_PIPELINE_STAGES.map((s) => s.id),
    ["nuevo_lead", "contactado", "interesado", "cotizacion", "negociacion", "pedido", "venta", "seguimiento", "perdido"],
  );
  DEFAULT_PIPELINE_STAGES.forEach((s, i) => assert.equal(s.order, i + 1));
  assert.equal(DEFAULT_PIPELINE_STAGES.find((s) => s.id === "perdido")?.kind, "perdida");
});

test("etiquetas por defecto con ids únicos y color hex", () => {
  assert.equal(new Set(DEFAULT_TAGS.map((t) => t.id)).size, DEFAULT_TAGS.length);
  for (const t of DEFAULT_TAGS) assert.match(t.color, /^#[0-9a-f]{6}$/i);
});

test("solo los vendedores arrancan disponibles para asignación automática", () => {
  const base = { uid: "u", orgId: "o", isDemo: false, displayName: "X", email: "x@x", actor: "system" };
  assert.equal(newMember({ ...base, role: "vendedor" }).available, true);
  assert.equal(newMember({ ...base, role: "supervisor" }).available, false);
  assert.equal(newMember({ ...base, role: "vendedor" }).active, true);
});

test("id de organización legible y sin acentos", () => {
  assert.equal(orgIdFromName("Distribuidora Pañitas & Cía.", () => "ab12"), "distribuidora-panitas-cia-ab12");
  assert.equal(orgIdFromName("***", () => "x"), "org-x");
});
