import { apiRoute } from "@/server/api/handler";
import { adminAuth } from "@/server/firebase/admin";

/**
 * Entrega un custom token para que el SDK del navegador quede autenticado como
 * el mismo usuario de la cookie. Lo usa el cliente para las lecturas en tiempo
 * real (Firestore + reglas) cuando su sesión local se perdió o no coincide.
 * La cookie del servidor es la fuente de verdad.
 */
export const POST = apiRoute({}, async ({ session }) => {
  const token = await adminAuth().createCustomToken(session.uid);
  return { token };
});
