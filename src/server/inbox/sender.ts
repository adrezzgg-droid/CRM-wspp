import "server-only";
import { randomUUID } from "node:crypto";
import { ApiError } from "@/server/api/handler";

/**
 * Salida de mensajes hacia WhatsApp. La bandeja no sabe si habla con Meta o
 * con el simulador: pide un emisor según la organización.
 *
 *  - Demo: nunca llama a Meta. Devuelve un wamid propio y el mensaje queda "enviado".
 *  - Real: WhatsApp Cloud API (se conecta en la Fase 9). Hasta entonces, avisa.
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
}

const demoSender: WhatsappSender = {
  mode: "demo",
  async sendText() {
    return { wamid: `wamid.demo.${randomUUID()}` };
  },
  async sendMedia() {
    return { wamid: `wamid.demo.${randomUUID()}` };
  },
};

const notConnected = async (): Promise<never> => {
  throw new ApiError(503, "WhatsApp todavía no está conectado para esta empresa. La conexión con Meta se configura en la Fase 9.");
};

const cloudSender: WhatsappSender = { mode: "cloud", sendText: notConnected, sendMedia: notConnected };

export function senderFor(org: { isDemo: boolean }): WhatsappSender {
  return org.isDemo ? demoSender : cloudSender;
}
