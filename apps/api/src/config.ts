import {
  commonEnvSchema,
  databaseEnvSchema,
  gcpEnvSchema,
  parseEnv,
  redisEnvSchema,
} from '@booster-ai/config';
import { z } from 'zod';

const apiEnvSchema = commonEnvSchema
  .merge(databaseEnvSchema)
  .merge(redisEnvSchema)
  .merge(gcpEnvSchema)
  .extend({
    SERVICE_NAME: z.literal('booster-ai-api'),
    CORS_ALLOWED_ORIGINS: z.string().transform((s) => s.split(',').filter(Boolean)),
    JWT_ISSUER: z.string().default('booster-ai'),
    FIREBASE_PROJECT_ID: z.string().min(1),

    /**
     * Audiences aceptadas en el OIDC token de Cloud Run SA-to-SA.
     *
     * Acepta CSV ("https://api.boosterchile.com,https://booster-ai-api-...run.app")
     * para soportar migración entre URLs públicas y *.run.app sin downtime —
     * mientras el bot caller está en transición de una a otra. Después de la
     * migración estable, dejar solo la URL canónica.
     *
     * Cada entrada debe ser una URL completa (https://...). El middleware de
     * auth chequea `claims.aud ∈ API_AUDIENCE`.
     *
     * Ver: https://cloud.google.com/run/docs/authenticating/service-to-service
     */
    API_AUDIENCE: z
      .string()
      .transform((s) =>
        s
          .split(',')
          .map((x) => x.trim())
          .filter(Boolean),
      )
      .refine(
        (arr) => arr.length > 0 && arr.every((u) => /^https?:\/\//.test(u)),
        'API_AUDIENCE debe ser CSV de URLs (al menos una)',
      ),

    /**
     * Email del SA que está autorizado a invocar endpoints protegidos.
     * En el thin slice: el SA del whatsapp-bot.
     */
    ALLOWED_CALLER_SA: z
      .string()
      .regex(/^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/, 'SA email inválido'),
  });

export type ApiEnv = z.infer<typeof apiEnvSchema>;

export const config: ApiEnv = parseEnv(apiEnvSchema);
