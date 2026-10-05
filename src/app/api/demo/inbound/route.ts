import { apiRoute, ApiError } from "@/server/api/handler";
import { simulateInbound } from "@/server/inbox/service";
import { demoInboundInput } from "@/lib/schemas";

/**
 * Simulador del modo demo: recibe un mensaje "del cliente" (JSON o multipart con
 * archivo) y lo hace entrar por la misma tubería que un webhook real de Meta.
 */
export const POST = apiRoute({}, async ({ req, session }) => {
  let raw: Record<string, unknown>;
  let file: File | undefined;
  if (req.headers.get("content-type")?.includes("multipart/form-data")) {
    const form = await req.formData();
    const f = form.get("file");
    if (f instanceof File && f.size > 0) file = f;
    raw = Object.fromEntries([...form.entries()].filter(([k, v]) => k !== "file" && typeof v === "string" && v !== ""));
  } else {
    raw = await req.json().catch(() => ({}));
  }
  const parsed = demoInboundInput.safeParse(raw);
  if (!parsed.success) throw new ApiError(422, "Datos inválidos", parsed.error.issues);
  return simulateInbound(session, parsed.data, file);
});
