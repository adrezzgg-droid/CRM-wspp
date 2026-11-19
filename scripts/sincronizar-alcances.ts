/**
 * Recalcula el alcance de la bandeja (inboxScope / scopeUids) de todos los
 * usuarios de todas las empresas. Hace falta una vez al publicar la Fase 10
 * (las reglas de Firestore lo leen de la ficha del usuario); después lo
 * mantiene el servidor solo. Si no se corre, se completa al iniciar sesión.
 *
 *   npm run alcances:sincronizar             → contra los emuladores (.env.local)
 *   npm run alcances:sincronizar -- --remoto → contra el proyecto real
 */
import { initAdmin, isEmulator, parseArgs } from "./lib/provision.ts";
import { syncAccessScopes } from "../src/server/members/scope-core.ts";

const args = parseArgs(process.argv.slice(2));
if (!isEmulator() && args.remoto !== true) {
  console.error("No hay emuladores configurados. Para el proyecto real usá --remoto.");
  process.exit(1);
}
const { db } = initAdmin();
const orgs = await db.collection("organizations").get();
for (const o of orgs.docs) console.log(`${o.id}: ${await syncAccessScopes(db, o.id)} usuario(s) actualizados`);
