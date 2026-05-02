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
     * CSV ("https://api.boosterchile.com,https://booster-ai-api-...run.app")
     * por diseño: el api acepta ambas URLs como audience válida.
     *   - *.run.app cubre tráfico interno Cloud Run-to-Cloud Run (canónico).
     *   - api.boosterchile.com cubre callers futuros que entren por el LB
     *     público y firmen el OIDC con la URL pública como audience.
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

    /**
     * Credenciales Twilio para enviar templates al carrier (B.8).
     *
     * El api comparte el mismo Sender (+19383365293) que apps/whatsapp-bot —
     * ambos servicios pueden mandar mensajes desde el mismo número porque
     * Twilio identifica el sender por From + auth, no por servicio.
     *
     * TWILIO_AUTH_TOKEN viene de Secret Manager (mismo secreto que el bot).
     * Si las 3 vars no están seteadas, el dispatcher de notificaciones
     * loggea warn y skipea el envío — útil en dev y entornos donde aún
     * no se aprobaron templates.
     */
    TWILIO_ACCOUNT_SID: z
      .string()
      .regex(/^AC[a-fA-F0-9]+$/, 'Account SID debe empezar con AC')
      .optional(),
    TWILIO_AUTH_TOKEN: z.string().min(16).optional(),
    TWILIO_FROM_NUMBER: z
      .string()
      .regex(/^\+\d+$/, 'Formato E.164 con +')
      .optional(),

    /**
     * Content SID del template aprobado para notificar al carrier que
     * llegó una nueva oferta. Viene de Twilio Content Editor tras
     * aprobación de Meta (24-48h tras submit).
     *
     * Variables esperadas (1-based):
     *   {{1}} → tracking_code
     *   {{2}} → "Origen → Destino"
     *   {{3}} → precio CLP formateado
     *   {{4}} → URL al dashboard del carrier
     *
     * Optional para permitir merge antes de la aprobación. Si está vacío,
     * el dispatcher loguea warn y skipea.
     *
     * IMPORTANTE: el preprocess trata string vacío como undefined. Cloud
     * Run / Terraform a veces pasan la env var como "" (no como ausente),
     * y `.optional()` solo cubre `undefined` — sin el preprocess, "" cae
     * al regex y mata el startup con FATAL. Lección de incidente
     * 2026-05-02 cuando un terraform apply sin -var dejó la var en "" y
     * el api revienta en boot.
     */
    CONTENT_SID_OFFER_NEW: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
      z
        .string()
        .regex(/^HX[a-fA-F0-9]+$/, 'Debe empezar con HX seguido de hex chars')
        .optional(),
    ),

    /**
     * URL pública del frontend, usada para construir el deep-link al
     * dashboard del carrier en el template.
     */
    WEB_APP_URL: z.string().url().default('https://app.boosterchile.com'),
  });

export type ApiEnv = z.infer<typeof apiEnvSchema>;

export const config: ApiEnv = parseEnv(apiEnvSchema);
