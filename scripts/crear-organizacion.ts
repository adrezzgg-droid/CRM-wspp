/**
 * Crea una organización REAL con su primer administrador.
 *
 *   npm run org:crear -- --nombre "Mi Distribuidora" --admin-email ana@empresa.com --admin-nombre "Ana López"
 *
 * Opcionales: --zona-horaria America/Argentina/Buenos_Aires  --moneda ARS  --forzar
 *
 * No se imprime ni se pide contraseña: si el usuario es nuevo, se genera un
 * enlace para que la defina él mismo.
 */
import { randomBytes } from "node:crypto";
import { orgIdFromName } from "../src/server/org/defaults.ts";
import { createOrganizationDocs, ensureUser, initAdmin, isEmulator, parseArgs, upsertMember } from "./lib/provision.ts";

const args = parseArgs(process.argv.slice(2));
const name = typeof args.nombre === "string" ? args.nombre.trim() : "";
const email = typeof args["admin-email"] === "string" ? args["admin-email"].trim().toLowerCase() : "";
const adminName = typeof args["admin-nombre"] === "string" ? args["admin-nombre"].trim() : "";

if (!name || !email || !adminName) {
  console.error('Uso: npm run org:crear -- --nombre "Empresa" --admin-email email --admin-nombre "Nombre"');
  process.exit(1);
}

const { auth, db } = initAdmin();
const orgId = orgIdFromName(name, () => randomBytes(3).toString("hex"));

console.log(`Destino: ${isEmulator() ? "EMULADOR" : `proyecto ${process.env.FIREBASE_PROJECT_ID}`}`);
// Primero el usuario: si ya pertenece a otra organización se aborta antes de crear nada.
const { uid, created } = await ensureUser(auth, { email, displayName: adminName, orgId, force: args.forzar === true });
await createOrganizationDocs(db, {
  id: orgId,
  name,
  isDemo: false,
  timezone: typeof args["zona-horaria"] === "string" ? args["zona-horaria"] : undefined,
  currency: typeof args.moneda === "string" ? args.moneda : undefined,
});

await upsertMember(auth, db, { uid, orgId, isDemo: false, displayName: adminName, email, role: "admin" });

console.log(`Organización creada: ${name} (${orgId})`);
console.log(`Administrador: ${email}${created ? " (usuario nuevo)" : " (usuario existente)"}`);
if (created) {
  const link = await auth.generatePasswordResetLink(email);
  console.log(`Enlace para que defina su contraseña:\n${link}`);
}
