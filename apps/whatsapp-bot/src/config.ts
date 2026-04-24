import { commonEnvSchema, gcpEnvSchema, parseEnv } from '@booster-ai/config';
import { z } from 'zod';

/**
 * Config específica de apps/whatsapp-bot.
 *
 * Secretos (WHATSAPP_APP_SECRET, WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID)
 * se inyectan via Cloud Run `--set-secrets` desde Secret Manager al startup.
 */
const whatsAppBotEnvSchema = commonEnvSchema.merge(gcpEnvSchema).extend({
  SERVICE_NAME: z.literal('booster-ai-whatsapp-bot'),

  /** App Secret de la Meta Business App — para verificar HMAC del webhook */
  WHATSAPP_APP_SECRET: z.string().min(16),

  /** Access Token de larga duración del Business System User */
  WHATSAPP_ACCESS_TOKEN: z.string().min(16),

  /** Phone Number ID que Meta asignó al número +56957790379 */
  WHATSAPP_PHONE_NUMBER_ID: z.string().regex(/^\d+$/, 'Solo dígitos'),

  /**
   * Verify token que configuramos en el Meta App Dashboard para la
   * verificación inicial del webhook (GET request con hub.challenge).
   * Es un string arbitrario que solo nosotros y Meta conocemos — generar con
   * `openssl rand -hex 32` y poner en Secret Manager.
   */
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().min(16),

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
