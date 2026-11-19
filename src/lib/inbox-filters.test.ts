import { test } from "node:test";
import assert from "node:assert/strict";
import { INBOX_FILTERS, inboxQuery } from "./inbox-filters.ts";

test("el vendedor siempre consulta lo suyo (requisito de las reglas)", () => {
  for (const f of INBOX_FILTERS) {
    const q = inboxQuery(f.id, { uid: "v1", scope: "propio" });
    if (q === null) continue;
    assert.deepEqual(q.clauses[0], ["assigneeId", "==", "v1"], f.id);
    assert.deepEqual(q.variants, [q.clauses]);
  }
});

test("el vendedor no tiene 'sin asignar'", () => {
  assert.equal(inboxQuery("sin_asignar", { uid: "v1", scope: "propio" }), null);
  assert.deepEqual(inboxQuery("sin_asignar", { uid: "a", scope: "todo" })?.clauses[0], ["assigneeId", "==", null]);
});

test("sin permiso de bandeja no hay consulta", () => {
  assert.equal(inboxQuery("todos", { uid: "r", scope: null }), null);
});

test("supervisor: su equipo y lo sin asignar en consultas separadas (lo que aceptan las reglas)", () => {
  const q = inboxQuery("todos", { uid: "s", scope: "equipo", scopeUids: ["s", "v1", "v2"] })!;
  assert.deepEqual(q.variants, [
    [["status", "in", ["nueva", "pendiente", "en_atencion"]], ["assigneeId", "in", ["s", "v1", "v2"]]],
    [["status", "in", ["nueva", "pendiente", "en_atencion"]], ["assigneeId", "==", null]],
  ]);
  for (const v of q.variants) assert.ok(!v.some(([f, op, val]) => f === "assigneeId" && op === "in" && (val as unknown[]).includes(null)), "nunca null dentro de un in");
  assert.deepEqual(inboxQuery("mias", { uid: "s", scope: "equipo", scopeUids: ["s", "v1"] })!.variants, [[["assigneeId", "==", "s"], ["status", "in", ["nueva", "pendiente", "en_atencion"]]]]);
  assert.equal(inboxQuery("sin_asignar", { uid: "s", scope: "equipo", scopeUids: ["s", "v1"] })!.variants.length, 1);
});

test("supervisor con un equipo grande: tandas que no pasan de 30 combinaciones", () => {
  const big = Array.from({ length: 25 }, (_, i) => `u${i}`);
  const q = inboxQuery("clientes", { uid: "s", scope: "equipo", scopeUids: big })!;
  // 4 etapas × 3 estados = 12 combinaciones por persona → de a 2 personas.
  for (const v of q.variants) {
    const n = v.filter(([, op]) => op === "in").reduce((acc, [, , val]) => acc * (val as unknown[]).length, 1);
    assert.ok(n <= 30, `${n} combinaciones`);
  }
  const covered = q.variants.flatMap((v) => v.filter(([f, op]) => f === "assigneeId" && op === "in").flatMap(([, , val]) => val as string[]));
  assert.deepEqual(new Set(covered), new Set(["s", ...big]));
});

test("cerrados no incluye abiertas y 'todos' no incluye cerradas", () => {
  assert.deepEqual(inboxQuery("cerrados", { uid: "a", scope: "todo" })?.clauses, [["status", "==", "cerrada"]]);
  assert.deepEqual(inboxQuery("todos", { uid: "a", scope: "todo" })?.clauses, [["status", "in", ["nueva", "pendiente", "en_atencion"]]]);
});

test("nuevos leads y clientes se distinguen por la etapa del cliente", () => {
  assert.deepEqual(inboxQuery("nuevos_leads", { uid: "a", scope: "todo" })?.clauses[0], ["customerStage", "==", "prospecto"]);
  const c = inboxQuery("clientes", { uid: "a", scope: "todo" })?.clauses[0];
  assert.equal(c?.[1], "in");
  assert.ok(!(c?.[2] as string[]).includes("prospecto"));
});

test("cada consulta de la bandeja tiene su índice compuesto (el emulador no lo exige, producción sí)", async () => {
  const { readFileSync } = await import("node:fs");
  const { indexes } = JSON.parse(readFileSync(new URL("../../firestore.indexes.json", import.meta.url), "utf8")) as {
    indexes: { collectionGroup: string; fields: { fieldPath: string; order?: string }[] }[];
  };
  const conv = indexes.filter((i) => i.collectionGroup === "conversations");
  const scopes = [
    { uid: "v1", scope: "propio" as const },
    { uid: "s", scope: "equipo" as const, scopeUids: ["s", "v1"] },
    { uid: "a", scope: "todo" as const },
  ];
  for (const ctx of scopes) {
    for (const f of INBOX_FILTERS) {
      for (const clauses of inboxQuery(f.id, ctx)?.variants ?? []) {
        const fields = [...new Set(clauses.map(([field]) => field))];
        // Un solo filtro de igualdad + orden por fecha también necesita índice compuesto.
        const ok = conv.some((i) => {
          const last = i.fields.at(-1)!;
          const rest = i.fields.slice(0, -1).map((x) => x.fieldPath);
          return last.fieldPath === "lastMessageAt" && last.order === "DESCENDING" && rest.length === fields.length && fields.every((x) => rest.includes(x));
        });
        assert.ok(ok, `${ctx.scope}/${f.id}: falta índice (${fields.join(", ")}, lastMessageAt desc)`);
      }
    }
  }
});
