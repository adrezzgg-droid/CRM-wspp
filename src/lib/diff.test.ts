import { test } from "node:test";
import assert from "node:assert/strict";
import { diffFields } from "./diff.ts";

type C = { name: string; phone?: string; tagIds: string[]; ownerId: string | null };
const before: C = { name: "Juan", phone: undefined, tagIds: ["a", "b"], ownerId: "v1" };
const keys = ["name", "phone", "tagIds", "ownerId"] as const;

test("detecta solo lo que cambió", () => {
  assert.deepEqual(diffFields(before, { name: "Juan", phone: "", tagIds: ["b", "a"] }, keys), {});
  assert.deepEqual(diffFields(before, { name: "Juan P." }, keys), { name: { before: "Juan", after: "Juan P." } });
});

test("registra asignaciones y quitas como null", () => {
  assert.deepEqual(diffFields(before, { ownerId: null, tagIds: ["a"] }, keys), {
    ownerId: { before: "v1", after: null },
    tagIds: { before: ["a", "b"], after: ["a"] },
  });
});

test("ignora campos que no vinieron en la actualización", () => {
  assert.deepEqual(diffFields(before, {}, keys), {});
});
