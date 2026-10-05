import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInboundPayload, isWindowOpen, messagePreview, parseWebhook, SERVICE_WINDOW_MS, type MetaWebhookPayload } from "./webhook.ts";

/** Payload con la forma documentada por Meta (varios mensajes y un estado). */
const payload: MetaWebhookPayload = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "102290129340398",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "15550783881", phone_number_id: "106540352242922" },
            contacts: [{ profile: { name: "Sheena Nelson" }, wa_id: "5493515551234" }],
            messages: [
              { from: "5493515551234", id: "wamid.TEXT", timestamp: "1749416383", type: "text", text: { body: "Hola, ¿precio del pollo?" } },
              { from: "5493515551234", id: "wamid.IMG", timestamp: "1749416390", type: "image", image: { id: "1003383421387256", mime_type: "image/jpeg", sha256: "x", caption: "Así llegó" } },
              { from: "5493515551234", id: "wamid.DOC", timestamp: "1749416391", type: "document", document: { id: "doc1", mime_type: "application/pdf", filename: "lista.pdf" } },
              { from: "5493515551234", id: "wamid.AUD", timestamp: "1749416392", type: "audio", audio: { id: "aud1", mime_type: "audio/ogg; codecs=opus", voice: true } },
              { from: "5493515551234", id: "wamid.LOC", timestamp: "1749416393", type: "location", location: { latitude: -31.42, longitude: -64.18, name: "Local", address: "Av. Colón 100" } },
              { from: "5493515551234", id: "wamid.CON", timestamp: "1749416394", type: "contacts", contacts: [{ name: { formatted_name: "Pedro" }, phones: [{ phone: "+54 9 351 111", wa_id: "549351111" }] }] },
              { from: "5493515551234", id: "wamid.BTN", timestamp: "1749416395", type: "interactive", interactive: { type: "button_reply", button_reply: { id: "si", title: "Sí, confirmo" } } },
              { from: "5493515551234", id: "wamid.LST", timestamp: "1749416396", type: "interactive", interactive: { type: "list_reply", list_reply: { id: "p2", title: "Pechuga x kg" } } },
              { from: "5493515551234", id: "wamid.TPL", timestamp: "1749416397", type: "button", button: { text: "Quiero repetir", payload: "repetir" } },
              { from: "5493515551234", id: "wamid.STK", timestamp: "1749416398", type: "sticker", sticker: { id: "st1", mime_type: "image/webp" } },
              { from: "5493515551234", id: "wamid.REA", timestamp: "1749416399", type: "reaction", reaction: { message_id: "wamid.X", emoji: "👍" } },
              { from: "5493515551234", id: "wamid.UNK", timestamp: "1749416400", type: "order" },
            ],
            statuses: [{ id: "wamid.OUT", status: "delivered", timestamp: "1749416401", recipient_id: "5493515551234" }],
          },
        },
      ],
    },
  ],
};

const parsed = parseWebhook(payload);
const byId = (id: string) => parsed.messages.find((m) => m.wamid === id)!;

test("texto con nombre de perfil, número y hora en ms", () => {
  const m = byId("wamid.TEXT");
  assert.equal(m.type, "text");
  assert.equal(m.text, "Hola, ¿precio del pollo?");
  assert.equal(m.profileName, "Sheena Nelson");
  assert.equal(m.from, "5493515551234");
  assert.equal(m.phoneNumberId, "106540352242922");
  assert.equal(m.timestamp, 1749416383000);
});

test("imágenes, documentos, audios y stickers como adjuntos", () => {
  assert.deepEqual(byId("wamid.IMG").media, { mediaId: "1003383421387256", mimeType: "image/jpeg", fileName: undefined, caption: "Así llegó" });
  assert.equal(byId("wamid.DOC").media?.fileName, "lista.pdf");
  assert.equal(byId("wamid.AUD").type, "audio");
  assert.equal(byId("wamid.STK").type, "image");
});

test("ubicación, contactos y respuestas a botones y listas", () => {
  assert.deepEqual(byId("wamid.LOC").location, { lat: -31.42, lng: -64.18, name: "Local", address: "Av. Colón 100" });
  assert.deepEqual(byId("wamid.CON").sharedContacts, [{ name: "Pedro", phones: ["549351111"] }]);
  assert.deepEqual(byId("wamid.BTN").interactive, { id: "si", title: "Sí, confirmo" });
  assert.equal(byId("wamid.LST").type, "list_reply");
  assert.equal(byId("wamid.TPL").type, "button_reply");
});

test("las reacciones se ignoran y lo desconocido queda registrado como texto", () => {
  assert.equal(parsed.messages.some((m) => m.wamid === "wamid.REA"), false);
  assert.match(byId("wamid.UNK").text ?? "", /no soportado/);
});

test("estados de entrega", () => {
  assert.deepEqual(parsed.statuses, [
    { phoneNumberId: "106540352242922", wamid: "wamid.OUT", status: "delivered", timestamp: 1749416401000, recipient: "5493515551234", errorCode: undefined },
  ]);
});

test("payloads ajenos o vacíos no rompen", () => {
  assert.deepEqual(parseWebhook({ object: "page" }), { messages: [], statuses: [] });
  assert.deepEqual(parseWebhook({ object: "whatsapp_business_account", entry: [{ id: "x", changes: [{ field: "account_update" }] }] }), { messages: [], statuses: [] });
});

test("el simulador arma exactamente el formato de Meta", () => {
  const p = buildInboundPayload({
    phoneNumberId: "demo",
    displayPhone: "5493510000000",
    from: "5493515550000",
    profileName: "Demo",
    wamid: "wamid.demo1",
    timestamp: 1_700_000_000_000,
    message: { type: "text", text: { body: "hola" } },
  });
  const r = parseWebhook(p);
  assert.equal(r.messages.length, 1);
  assert.equal(r.messages[0].text, "hola");
  assert.equal(r.messages[0].timestamp, 1_700_000_000_000);
});

test("vista previa y ventana de 24 h", () => {
  assert.equal(messagePreview({ type: "document", media: { fileName: "lista.pdf" } }), "📄 lista.pdf");
  assert.equal(messagePreview({ type: "button_reply", interactive: { title: "Sí" } }), "↩ Sí");
  assert.equal(messagePreview({ type: "text", text: "x".repeat(200) }).length, 118);
  const now = 1_000_000;
  assert.equal(isWindowOpen(now + 1, now), true);
  assert.equal(isWindowOpen(now - SERVICE_WINDOW_MS, now), false);
  assert.equal(isWindowOpen(undefined, now), false);
});
