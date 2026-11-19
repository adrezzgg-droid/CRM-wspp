import { after, NextResponse, type NextRequest } from "next/server";
import { webhookDeps } from "@/server/whatsapp/deps";
import { acceptWebhook, processWebhookEvent, verifyWebhookToken, WebhookRejected } from "@/server/whatsapp/webhook-core";

/**
 * Webhook de WhatsApp Cloud API (Meta). Público, sin sesión: la autenticidad
 * la da la firma X-Hub-Signature-256 de cada parte del payload.
 *
 * Meta reintenta si no recibe 200 rápido: se valida y guarda el evento, se
 * responde, y el procesamiento sigue después de la respuesta (`after`). Si
 * algo falla, la tarea programada lo reintenta.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Verificación de la URL (al configurar el webhook en Meta for Developers). */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const ok = q.get("hub.mode") === "subscribe" && (await verifyWebhookToken(webhookDeps(), q.get("hub.verify_token")));
  if (!ok) return NextResponse.json({ error: "Verify Token inválido" }, { status: 403 });
  return new Response(q.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (raw.length > 3_000_000) return NextResponse.json({ error: "Demasiado grande" }, { status: 413 });
  const deps = webhookDeps();
  let ids: string[];
  try {
    ids = await acceptWebhook(deps, raw, req.headers.get("x-hub-signature-256"));
  } catch (error) {
    if (error instanceof WebhookRejected) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[webhook] no se pudo guardar el evento", error);
    // 500: Meta lo vuelve a mandar más tarde.
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
  after(async () => {
    for (const id of ids) await processWebhookEvent(deps, id);
  });
  return NextResponse.json({ ok: true });
}
