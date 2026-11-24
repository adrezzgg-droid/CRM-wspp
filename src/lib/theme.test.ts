import { test } from "node:test";
import assert from "node:assert/strict";
import { colorScheme, parseTheme, themeClass } from "./theme.ts";

test("tema: por defecto sigue al sistema y descarta valores raros", () => {
  assert.equal(parseTheme(undefined), "sistema");
  assert.equal(parseTheme(""), "sistema");
  assert.equal(parseTheme("azul"), "sistema");
  assert.equal(parseTheme("oscuro"), "oscuro");
  assert.equal(parseTheme("claro"), "claro");
});

test("tema: clase de <html> y color-scheme", () => {
  assert.equal(themeClass("oscuro"), "tema-oscuro");
  assert.equal(colorScheme("claro"), "light");
  assert.equal(colorScheme("oscuro"), "dark");
  assert.equal(colorScheme("sistema"), "light dark");
});
