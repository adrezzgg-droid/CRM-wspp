import "server-only";
import { randomUUID } from "node:crypto";
import { adminBucket } from "@/server/firebase/admin";
import { withGraph } from "@/server/whatsapp/service";
import { markAsRead, mediaPayload, sendMessage, templatePayload, textPayload, uploadMedia } from "@/server/whatsapp/graph";

/**
 * Salida de mensajes hacia WhatsApp. La bandeja no sabe si habla con Meta o
 * con el simulador: pide un emisor según la organización.
 *
 *  - Demo: nunca llama a Meta. Devuelve un wamid propio y el mensaje queda "enviado".
 *  - Real: WhatsApp Cloud API con las credenciales cifradas de la empresa.
 *    Los errores de Meta llegan traducidos (ApiError) a quien envía.
 */
export interface OutboundMedia {
  kind: "image" | "document" | "audio" | "video";
  /** Archivo ya guardado en Storage. */
  storagePath: string;
  mimeType: string;
  fileName?: string;
  caption?: string;
}

export interface WhatsappSender {
  readonly mode: "demo" | "cloud";
  sendText(to: string, text: string): Promise<{ wamid: string }>;
  sendMedia(to: string, media: OutboundMedia): Promise<{ wamid: string }>;
  /** Plantilla aprobada por Meta (la única forma de escribir fuera de las 24 h). */
  sendTemplate(to: string, template: { name: string; language: string; params: string[] }): Promise<{ wamid: string }>;
  /** Confirmación de lectura al cliente (mejor esfuerzo: nunca falla). */
  markRead(wamid: string): Promise<void>;
}

const demoSender: WhatsappSender = {
  mode: "demo",
  async sendText() {
    return { wamid: `wamid.demo.${randomUUID()}` };
  },
  async sendMedia() {
    return { wamid: `wamid.demo.${randomUUID()}` };
  },
  async sendTemplate() {
    return { wamid: `wamid.demo.${randomUUID()}` };
  },
  async markRead() {},
};

function cloudSender(orgId: string): WhatsappSender {
  return {
    mode: "cloud",
    sendText: (to, text) => withGraph(orgId, (cfg, c) => sendMessage(cfg, c.account.phoneNumberId, textPayload(to, text))),
    sendTemplate: (to, t) => withGraph(orgId, (cfg, c) => sendMessage(cfg, c.account.phoneNumberId, templatePayload(to, t))),
    sendMedia: (to, media) =>
      withGraph(orgId, async (cfg, c) => {
        // Meta no acepta enlaces a nuestro Storage privado: se sube el archivo y se manda su id.
        const [buffer] = await adminBucket().file(media.storagePath).download();
        const mediaId = await uploadMedia(cfg, c.account.phoneNumberId, { bytes: new Uint8Array(buffer), mimeType: media.mimeType, fileName: media.fileName ?? "archivo" });
        return sendMessage(cfg, c.account.phoneNumberId, mediaPayload(to, media.kind, mediaId, { caption: media.caption, fileName: media.fileName }));
      }),
    markRead: async (wamid) => {
      await withGraph(orgId, (cfg, c) => markAsRead(cfg, c.account.phoneNumberId, wamid)).catch((error) => console.warn("[whatsapp] confirmación de lectura", error));
    },
  };
}

export function senderFor(org: { id: string; isDemo: boolean }): WhatsappSender {
  return org.isDemo ? demoSender : cloudSender(org.id);
}
