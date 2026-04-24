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
     * Audience esperada en el OIDC token de Cloud Run SA-to-SA.
     * Debe coincidir exactamente con la URL del service api (https://...).
     * Ver: https://cloud.google.com/run/docs/authenticating/service-to-service
     */
    API_AUDIENCE: z.string().url(),

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
