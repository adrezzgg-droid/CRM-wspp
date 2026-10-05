import "server-only";
import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { serverEnv, usingEmulators } from "../env";

type Bucket = ReturnType<ReturnType<typeof getStorage>["bucket"]>;

/**
 * Firebase Admin SDK. Solo existe en el servidor: es el único que escribe en
 * Firestore (las reglas niegan toda escritura desde el navegador).
 */

let app: App | undefined;
let db: Firestore | undefined;

function adminApp(): App {
  if (app) return app;
  const existing = getApps()[0];
  if (existing) return (app = existing);

  const env = serverEnv();
  if (env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY) {
    app = initializeApp({
      projectId: env.FIREBASE_PROJECT_ID,
      credential: cert({
        projectId: env.FIREBASE_PROJECT_ID,
        clientEmail: env.FIREBASE_CLIENT_EMAIL,
        // En .env la clave viaja con "\n" literales.
        privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      }),
    });
  } else if (usingEmulators(env)) {
    app = initializeApp({ projectId: env.FIREBASE_PROJECT_ID });
  } else {
    throw new Error(
      "Faltan FIREBASE_CLIENT_EMAIL y FIREBASE_PRIVATE_KEY (o configurar los emuladores).",
    );
  }
  return app;
}

export function adminAuth(): Auth {
  return getAuth(adminApp());
}

/** Bucket de adjuntos. Solo el servidor accede (storage.rules niega todo al navegador). */
export function adminBucket(): Bucket {
  const name = serverEnv().FIREBASE_STORAGE_BUCKET;
  if (!name) throw new Error("Falta FIREBASE_STORAGE_BUCKET para guardar adjuntos.");
  return getStorage(adminApp()).bucket(name);
}

// settings() solo puede llamarse una vez por instancia; en desarrollo el
// recargado en caliente reevalúa este módulo, así que la marca vive en globalThis.
const configured = globalThis as { __crmFirestoreConfigured?: boolean };

export function adminDb(): Firestore {
  if (!db) {
    db = getFirestore(adminApp());
    if (!configured.__crmFirestoreConfigured) {
      // preferRest: arranque más rápido en serverless (Vercel). Con el emulador
      // no aplica: el transporte REST ignora FIRESTORE_EMULATOR_HOST.
      db.settings({ ignoreUndefinedProperties: true, preferRest: !usingEmulators() });
      configured.__crmFirestoreConfigured = true;
    }
  }
  return db;
}
