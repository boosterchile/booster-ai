import { z } from 'zod';

/**
 * Config del sms-fallback-gateway. Validada con zod al startup.
 */
const envSchema = z.object({
  /** Puerto HTTP donde el Cloud Run service escucha. */
  PORT: z
    .string()
    .default('8080')
    .transform((s) => Number.parseInt(s, 10))
    .pipe(z.number().int().min(1).max(65535)),

  /** GCP project ID para Pub/Sub. */
  GOOGLE_CLOUD_PROJECT: z.string().min(1),

  /** Topic donde publicamos los TelemetryEvents reconstruidos. Mismo
   *  topic que el TCP gateway → mismo processor downstream. */
  PUBSUB_TOPIC_TELEMETRY: z.string().default('telemetry-events'),

  /**
   * Auth Token Twilio para verificar firma del webhook. Inyectado
   * desde Secret Manager (`twilio-auth-token`). En envs locales/test
   * puede dejarse vacío para skip de la validación — explicitarlo en
   * el log al startup.
   */
  TWILIO_AUTH_TOKEN: z.string().default(''),

  /**
   * URL pública canónica del webhook tal como Twilio la conoce.
   * Necesario para el HMAC del signature check (Twilio lo incluye
   * en el HMAC como string base). Ejemplo:
   *   https://booster-ai-sms-fallback.run.app/webhook
   */
  WEBHOOK_PUBLIC_URL: z.string().default(''),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
});

export type Config = z.infer<typeof envSchema>;

export class InvalidConfigError extends Error {
  readonly issues: { path: string; message: string }[];
  constructor(issues: { path: string; message: string }[]) {
    super('Invalid environment configuration. Refusing to start.');
    this.name = 'InvalidConfigError';
    this.issues = issues;
  }
}

export function loadConfig(): Config {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new InvalidConfigError(
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return parsed.data;
}
