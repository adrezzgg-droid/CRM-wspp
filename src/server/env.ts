import "server-only";
import { z } from "zod";

/**
 * Variables de entorno del servidor, validadas una sola vez.
 *
 * Se leen de forma perezosa (no al importar el módulo) para que `next build`
 * no exija secretos que solo se usan en tiempo de ejecución.
 */
const schema = z.object({
  APP_URL: z.url().optional(),
  FIREBASE_PROJECT_ID: z.string().min(1, "FIREBASE_PROJECT_ID es obligatoria"),
  FIREBASE_CLIENT_EMAIL: z.string().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),
  FIRESTORE_EMULATOR_HOST: z.string().optional(),
  FIREBASE_AUTH_EMULATOR_HOST: z.string().optional(),
  SESSION_DAYS: z.coerce.number().int().min(1).max(14).default(5),
  SECRETS_ENCRYPTION_KEY: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_GRAPH_API_VERSION: z.string().default("v23.0"),
  CRON_SECRET: z.string().optional(),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  if (cached) return cached;
  // Las variables vacías del .env cuentan como ausentes.
  const raw = Object.fromEntries(
    Object.entries(process.env).filter(([, v]) => v !== undefined && v !== ""),
  );
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Variables de entorno inválidas: ${detail}`);
  }
  cached = parsed.data;
  return cached;
}

export function usingEmulators(env: ServerEnv = serverEnv()): boolean {
  return !!(env.FIRESTORE_EMULATOR_HOST || env.FIREBASE_AUTH_EMULATOR_HOST);
}
