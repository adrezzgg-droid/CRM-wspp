import { test } from "node:test";
import assert from "node:assert/strict";
import { scopeAllows, teamUidsFor } from "./scope.ts";

const teams = [
  { leaderIds: ["sup"], memberIds: ["v1", "v2"] },
  { leaderIds: ["otro"], memberIds: ["v3"] },
];

test("propio: solo lo asignado al usuario, nunca lo sin asignar", () => {
  const ctx = { uid: "v1", scope: "propio" as const, teamUids: [] };
  assert.equal(scopeAllows(ctx, "v1"), true);
  assert.equal(scopeAllows(ctx, "v2"), false);
  assert.equal(scopeAllows(ctx, null), false);
});

test("equipo: lo de su equipo y lo sin asignar", () => {
  const ctx = { uid: "sup", scope: "equipo" as const, teamUids: teamUidsFor("sup", teams) };
  assert.equal(scopeAllows(ctx, "v1"), true);
  assert.equal(scopeAllows(ctx, "sup"), true);
  assert.equal(scopeAllows(ctx, null), true);
  assert.equal(scopeAllows(ctx, "v3"), false);
});

test("todo y sin permiso", () => {
  assert.equal(scopeAllows({ uid: "a", scope: "todo", teamUids: [] }, "cualquiera"), true);
  assert.equal(scopeAllows({ uid: "a", scope: null, teamUids: [] }, "a"), false);
});

test("teamUidsFor solo cuenta equipos que lidera", () => {
  assert.deepEqual(teamUidsFor("sup", teams).sort(), ["sup", "v1", "v2"]);
  assert.deepEqual(teamUidsFor("v1", teams), ["v1"]);
});
