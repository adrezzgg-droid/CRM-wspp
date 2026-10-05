import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ROLES } from "../server/permissions/matrix.ts";
import {
  CONFIG_SECTIONS,
  MAIN_NAV,
  configSectionsFor,
  landingFor,
  mainNavFor,
} from "./navigation.ts";

const APP_DIR = join(import.meta.dirname, "..", "app", "(app)");

const hrefs = (role: (typeof ROLES)[number]) => mainNavFor(role).map((i) => i.href);

test("cada ítem del menú tiene su página", () => {
  for (const item of MAIN_NAV) {
    assert.ok(existsSync(join(APP_DIR, item.href, "page.tsx")), `falta la página de ${item.href}`);
  }
  assert.ok(existsSync(join(APP_DIR, "configuracion", "[seccion]", "page.tsx")));
});

test("no hay páginas de módulos fuera del mapa de navegación", () => {
  const known = new Set([...MAIN_NAV.map((i) => i.href.slice(1)), "configuracion", "sin-acceso"]);
  const dirs = readdirSync(APP_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  for (const dir of dirs) assert.ok(known.has(dir), `ruta sin permiso asociado: /${dir}`);
});

test("admin ve todo el menú y todas las secciones de configuración", () => {
  assert.equal(mainNavFor("admin").length, MAIN_NAV.length + 1);
  assert.equal(configSectionsFor("admin").length, CONFIG_SECTIONS.length);
});

test("vendedor: sin dashboard, auditoría, usuarios ni WhatsApp", () => {
  const nav = hrefs("vendedor");
  for (const h of ["/dashboard", "/auditoria"]) assert.ok(!nav.includes(h), h);
  for (const h of ["/mi-dia", "/inbox", "/clientes", "/pipeline", "/pedidos", "/tareas"]) {
    assert.ok(nav.includes(h), h);
  }
  const sections = configSectionsFor("vendedor").map((s) => s.slug);
  for (const s of ["usuarios", "roles", "whatsapp", "automatizaciones", "empresa"]) {
    assert.ok(!sections.includes(s), s);
  }
});

test("repartidor: solo su día, pedidos, tareas y sus notificaciones", () => {
  assert.deepEqual(hrefs("repartidor"), ["/mi-dia", "/pedidos", "/tareas", "/configuracion"]);
  assert.deepEqual(configSectionsFor("repartidor").map((s) => s.slug), ["notificaciones"]);
});

test("pantalla de inicio por rol", () => {
  assert.equal(landingFor("admin"), "/dashboard");
  assert.equal(landingFor("supervisor"), "/dashboard");
  assert.equal(landingFor("solo_lectura"), "/dashboard");
  assert.equal(landingFor("vendedor"), "/mi-dia");
  assert.equal(landingFor("repartidor"), "/mi-dia");
});

test("los overrides de la organización cambian el menú", () => {
  const nav = mainNavFor("vendedor", {
    vendedor: { dashboard: { actions: ["ver"], scope: "propio" } },
  }).map((i) => i.href);
  assert.ok(nav.includes("/dashboard"));
});
