import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { actionsOf, AUDIT_ACTION_LABELS, AUDIT_CATEGORY_IDS, auditChanges, toCsv } from "./audit-labels.ts";

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const path = join(dir, f);
    return statSync(path).isDirectory() ? sources(path) : /\.tsx?$/.test(f) && !f.includes(".test.") ? [path] : [];
  });
}

test("toda acción que se registra en la auditoría tiene nombre y categoría", () => {
  const recorded = new Set<string>();
  for (const file of [...sources("src/server"), ...sources("scripts")]) {
    const code = readFileSync(file, "utf8");
    for (const m of code.matchAll(/(?:action:\s*|audit\(session,\s*|\?\s*|:\s*)"([a-z]+\.[a-z_]+)"/g)) {
      if (/^(auth|member|team|permissions|org|organization|settings|zone|tag|product|whatsapp|template|automation|integration)\./.test(m[1])) recorded.add(m[1]);
    }
  }
  assert.ok(recorded.size > 20, "encontró las acciones en el código");
  for (const a of recorded) assert.ok(AUDIT_ACTION_LABELS[a], `falta el nombre de "${a}"`);
  const categorized = new Set(AUDIT_CATEGORY_IDS.flatMap(actionsOf));
  for (const a of Object.keys(AUDIT_ACTION_LABELS)) assert.ok(categorized.has(a), `"${a}" no está en ninguna categoría`);
  for (const c of AUDIT_CATEGORY_IDS) assert.ok(actionsOf(c).length <= 30, `${c}: más de 30 acciones (límite de "in")`);
});

test("cambios campo por campo y CSV seguro para planillas", () => {
  assert.deepEqual(auditChanges({ role: "vendedor", name: "Ana" }, { role: "supervisor", name: "Ana" }), [{ field: "role", before: "vendedor", after: "supervisor" }]);
  assert.deepEqual(auditChanges(undefined, { enabled: true }), [{ field: "enabled", before: "—", after: "true" }]);
  assert.deepEqual(auditChanges(undefined, undefined), []);
  const csv = toCsv([["Fecha", "Acción"], ["01/01", '=HYPERLINK("x")'], ["02/01", 'dice "hola", chau']]);
  assert.ok(csv.startsWith("﻿"), "con BOM para Excel");
  assert.match(csv, /"'=HYPERLINK\(""x""\)"/, "una fórmula se neutraliza");
  assert.match(csv, /"dice ""hola"", chau"/);
});
