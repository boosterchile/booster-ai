import { z } from 'zod';

/**
 * Schemas del payload de webhook de Meta WhatsApp Business API v20.0.
 *
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks
 *
 * Meta garantiza entrega at-least-once. El bot debe ser idempotente por `message.id`.
 */

const WhatsAppTextMessage = z.object({
  from: z.string(), // wa_id (E.164 sin "+")
  id: z.string(), // message id, único por Meta
  timestamp: z.string(), // unix seconds
  type: z.literal('text'),
  text: z.object({ body: z.string() }),
});
export type WhatsAppTextMessage = z.infer<typeof WhatsAppTextMessage>;

const WhatsAppUnsupportedMessage = z
  .object({
    from: z.string(),
    id: z.string(),
    timestamp: z.string(),
    type: z.string(),
  })
  .passthrough();
export type WhatsAppUnsupportedMessage = z.infer<typeof WhatsAppUnsupportedMessage>;

export const WhatsAppIncomingMessage = z.union([WhatsAppTextMessage, WhatsAppUnsupportedMessage]);
export type WhatsAppIncomingMessage = z.infer<typeof WhatsAppIncomingMessage>;

const WhatsAppContact = z.object({
  profile: z.object({ name: z.string() }),
  wa_id: z.string(),
});

const WhatsAppWebhookChange = z.object({
  field: z.literal('messages'),
  value: z.object({
    messaging_product: z.literal('whatsapp'),
    metadata: z.object({
      display_phone_number: z.string(),
      phone_number_id: z.string(),
    }),
    contacts: z.array(WhatsAppContact).optional(),
    messages: z.array(WhatsAppIncomingMessage).optional(),
    statuses: z.array(z.unknown()).optional(), // ignorados en este slice
  }),
});

export const WhatsAppWebhookPayload = z.object({
  object: z.literal('whatsapp_business_account'),
  entry: z.array(
    z.object({
      id: z.string(),
      changes: z.array(WhatsAppWebhookChange),
    }),
  ),
});
export type WhatsAppWebhookPayload = z.infer<typeof WhatsAppWebhookPayload>;

/**
 * Helper: detecta si un mensaje entrante es texto y devuelve tipado narrow.
 */
export function isTextMessage(msg: WhatsAppIncomingMessage): msg is WhatsAppTextMessage {
  return msg.type === 'text';
}
