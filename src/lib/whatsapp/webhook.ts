/**
 * Traducción del webhook de WhatsApp Cloud API (Meta) a eventos internos.
 * Código puro: lo usan el webhook real (Fase 9), el simulador demo y las pruebas.
 *
 * Formato: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples
 */
import type { MessageType } from "../../types/model.ts";

// ───────────────────────── Forma del payload de Meta ────────────────────────

interface MetaMedia {
  id: string;
  mime_type?: string;
  sha256?: string;
  caption?: string;
  filename?: string;
  voice?: boolean;
}

export interface MetaMessage {
  from: string;
  id: string;
  timestamp: string; // segundos epoch, como texto
  type: string;
  text?: { body: string };
  image?: MetaMedia;
  document?: MetaMedia;
  audio?: MetaMedia;
  video?: MetaMedia;
  sticker?: MetaMedia;
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  contacts?: { name?: { formatted_name?: string; first_name?: string }; phones?: { phone?: string; wa_id?: string }[] }[];
  interactive?: {
    type: "button_reply" | "list_reply";
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string; description?: string };
  };
  button?: { text: string; payload?: string };
  reaction?: { message_id: string; emoji?: string };
  context?: { from?: string; id?: string };
}

export interface MetaStatus {
  id: string;
  status: "sent" | "delivered" | "read" | "failed";
  timestamp: string;
  recipient_id: string;
  errors?: { code: number; title?: string; message?: string }[];
}

export interface MetaWebhookPayload {
  object: string;
  entry?: {
    id: string;
    changes?: {
      field: string;
      value?: {
        messaging_product?: string;
        metadata?: { display_phone_number?: string; phone_number_id: string };
        contacts?: { profile?: { name?: string }; wa_id: string }[];
        messages?: MetaMessage[];
        statuses?: MetaStatus[];
      };
    }[];
  }[];
}

// ───────────────────────────── Eventos internos ─────────────────────────────

export interface InboundMessage {
  phoneNumberId: string;
  wamid: string;
  from: string; // wa_id
  profileName?: string;
  timestamp: number; // epoch ms
  type: MessageType;
  text?: string;
  media?: { mediaId: string; mimeType: string; fileName?: string; caption?: string };
  location?: { lat: number; lng: number; name?: string; address?: string };
  interactive?: { id: string; title: string };
  sharedContacts?: { name: string; phones: string[] }[];
  replyToId?: string;
}

export interface StatusUpdate {
  phoneNumberId: string;
  wamid: string;
  status: MetaStatus["status"];
  timestamp: number;
  recipient: string;
  errorCode?: string;
}

export interface ParsedWebhook {
  messages: InboundMessage[];
  statuses: StatusUpdate[];
}

const MEDIA_TYPES = ["image", "document", "audio", "video", "sticker"] as const;

function toMs(seconds: string): number {
  const n = Number(seconds);
  return Number.isFinite(n) ? n * 1000 : Date.now();
}

function parseMessage(m: MetaMessage, phoneNumberId: string, profileName?: string): InboundMessage | null {
  const base = {
    phoneNumberId,
    wamid: m.id,
    from: m.from.replace(/\D/g, ""),
    profileName,
    timestamp: toMs(m.timestamp),
    replyToId: m.context?.id,
  };

  if (m.type === "text" && m.text) return { ...base, type: "text", text: m.text.body };

  if ((MEDIA_TYPES as readonly string[]).includes(m.type)) {
    const media = m[m.type as (typeof MEDIA_TYPES)[number]];
    if (!media) return null;
    // Los stickers se muestran como imagen.
    const type = (m.type === "sticker" ? "image" : m.type) as MessageType;
    return {
      ...base,
      type,
      text: media.caption,
      media: { mediaId: media.id, mimeType: media.mime_type ?? "application/octet-stream", fileName: media.filename, caption: media.caption },
    };
  }

  if (m.type === "location" && m.location) {
    const { latitude, longitude, name, address } = m.location;
    return { ...base, type: "location", location: { lat: latitude, lng: longitude, name, address } };
  }

  if (m.type === "contacts" && m.contacts) {
    return {
      ...base,
      type: "contacts",
      sharedContacts: m.contacts.map((c) => ({
        name: c.name?.formatted_name ?? c.name?.first_name ?? "Contacto",
        phones: (c.phones ?? []).map((p) => p.wa_id ?? p.phone ?? "").filter(Boolean),
      })),
    };
  }

  if (m.type === "interactive" && m.interactive) {
    const reply = m.interactive.type === "list_reply" ? m.interactive.list_reply : m.interactive.button_reply;
    if (!reply) return null;
    return { ...base, type: m.interactive.type, interactive: { id: reply.id, title: reply.title }, text: reply.title };
  }

  // Respuesta rápida a una plantilla.
  if (m.type === "button" && m.button) {
    return { ...base, type: "button_reply", interactive: { id: m.button.payload ?? m.button.text, title: m.button.text }, text: m.button.text };
  }

  // Reacciones: no son un mensaje nuevo para el equipo.
  if (m.type === "reaction") return null;

  return { ...base, type: "text", text: `[Mensaje de tipo "${m.type}" no soportado por WhatsApp Cloud API]` };
}

/** Extrae mensajes entrantes y cambios de estado. Ignora lo que no entiende. */
export function parseWebhook(payload: MetaWebhookPayload): ParsedWebhook {
  const out: ParsedWebhook = { messages: [], statuses: [] };
  if (payload?.object !== "whatsapp_business_account") return out;

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages" || !change.value?.metadata) continue;
      const { metadata, contacts = [], messages = [], statuses = [] } = change.value;
      const names = new Map(contacts.map((c) => [c.wa_id, c.profile?.name]));

      for (const m of messages) {
        const parsed = parseMessage(m, metadata.phone_number_id, names.get(m.from));
        if (parsed) out.messages.push(parsed);
      }
      for (const s of statuses) {
        out.statuses.push({
          phoneNumberId: metadata.phone_number_id,
          wamid: s.id,
          status: s.status,
          timestamp: toMs(s.timestamp),
          recipient: s.recipient_id,
          errorCode: s.errors?.[0] ? String(s.errors[0].code) : undefined,
        });
      }
    }
  }
  return out;
}

/** Texto corto para la lista de conversaciones. */
export function messagePreview(m: { type: MessageType; text?: string; media?: { fileName?: string }; location?: { name?: string }; interactive?: { title: string } }): string {
  const clip = (s: string) => (s.length > 120 ? `${s.slice(0, 117)}…` : s);
  switch (m.type) {
    case "text":
    case "internal_note":
      return clip(m.text ?? "");
    case "image":
      return m.text ? `📷 ${clip(m.text)}` : "📷 Imagen";
    case "video":
      return m.text ? `🎬 ${clip(m.text)}` : "🎬 Video";
    case "audio":
      return "🎤 Audio";
    case "document":
      return `📄 ${m.media?.fileName ?? m.text ?? "Documento"}`;
    case "location":
      return `📍 ${m.location?.name ?? "Ubicación"}`;
    case "contacts":
      return "👤 Contacto";
    case "button_reply":
    case "list_reply":
      return `↩ ${m.interactive?.title ?? m.text ?? "Respuesta"}`;
    case "template":
      return clip(m.text ?? "Plantilla");
    default:
      return "Mensaje";
  }
}

/** Ventana de atención de 24 h de Meta. */
export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function isWindowOpen(serviceWindowEndsAt: number | undefined, now = Date.now()): boolean {
  return !!serviceWindowEndsAt && now < serviceWindowEndsAt;
}

/**
 * Arma un payload idéntico al de Meta para un mensaje entrante. Lo usa el
 * simulador del modo demo para entrar por la misma tubería que lo real.
 */
export function buildInboundPayload(input: {
  phoneNumberId: string;
  displayPhone: string;
  from: string;
  profileName?: string;
  wamid: string;
  timestamp: number;
  message: Omit<MetaMessage, "from" | "id" | "timestamp">;
}): MetaWebhookPayload {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "demo-waba",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: input.displayPhone, phone_number_id: input.phoneNumberId },
              contacts: [{ profile: { name: input.profileName }, wa_id: input.from }],
              messages: [{ ...input.message, from: input.from, id: input.wamid, timestamp: String(Math.floor(input.timestamp / 1000)) }],
            },
          },
        ],
      },
    ],
  };
}
