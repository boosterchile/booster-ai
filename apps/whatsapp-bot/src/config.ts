import { commonEnvSchema, gcpEnvSchema, parseEnv } from '@booster-ai/config';
import { z } from 'zod';

/**
 * Config específica de apps/whatsapp-bot — Twilio WhatsApp BSP.
 *
 * El número físico está provisionado en Twilio (+1 938-336-5293), por lo que
 * todo el messaging path va via Twilio API en lugar de Meta Cloud API directo.
 *
 * Secretos (TWILIO_AUTH_TOKEN) se inyectan via Cloud Run --set-secrets desde
 * Secret Manager. TWILIO_ACCOUNT_SID y TWILIO_FROM_NUMBER son env vars
 * regulares (no tan sensibles, pero se setean junto a los secrets para
 * mantener todo el bundle de Twilio en un solo lugar).
 */
const whatsAppBotEnvSchema = commonEnvSchema.merge(gcpEnvSchema).extend({
  SERVICE_NAME: z.literal('booster-ai-whatsapp-bot'),

  /** Twilio Account SID (empieza con AC) */
  TWILIO_ACCOUNT_SID: z.string().regex(/^AC[a-fA-F0-9]+$/, 'Account SID debe empezar con AC'),

  /** Twilio Auth Token de la cuenta — se usa para HMAC del webhook + Basic auth para enviar */
  TWILIO_AUTH_TOKEN: z.string().min(16),

  /** Número WhatsApp Twilio en formato E.164 con `+` */
  TWILIO_FROM_NUMBER: z.string().regex(/^\+\d+$/, 'Formato E.164 con +'),

  /**
   * URL pública exacta del webhook (la que Twilio usa para POSTs entrantes).
   * Necesaria para validar X-Twilio-Signature: el HMAC se calcula sobre
   * URL completa + sorted params, y Twilio usa la URL configurada en su
   * console — si Cloud Run / LB la rewrite, validación falla.
   */
  TWILIO_WEBHOOK_URL: z.string().url(),

  /** URL del apps/api — para llamar POST /trip-requests */
  API_URL: z.string().url(),

  /**
   * Audience del OIDC token para llamar al api.
   * Típicamente es la misma API_URL.
   */
  API_OIDC_AUDIENCE: z.string().url(),

  /**
   * TTL de la sesión de conversación (ms). Después de este tiempo sin
   * actividad, la sesión se borra y el usuario empieza de cero.
   */
  CONVERSATION_TTL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(30 * 60 * 1000),
});

export type WhatsAppBotEnv = z.infer<typeof whatsAppBotEnvSchema>;

export const config: WhatsAppBotEnv = parseEnv(whatsAppBotEnvSchema);
