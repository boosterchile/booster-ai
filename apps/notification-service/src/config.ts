import { z } from 'zod';

/**
 * Config de notification-service (T10-21). Todo input externo (env) pasa por
 * Zod al startup; con config inválida el servicio se rehúsa a arrancar.
 */
const envSchema = z.object({
  GOOGLE_CLOUD_PROJECT: z.string().min(1),

  /** Subscription pull del topic `notification-events` (messaging.tf). */
  PUBSUB_SUBSCRIPTION_NOTIFICATION_EVENTS: z.string().min(1).default('notification-events-sub'),

  /** Credenciales Twilio (Secret Manager) y sender propio del servicio. */
  TWILIO_ACCOUNT_SID: z.string().regex(/^AC[a-fA-F0-9]+$/),
  TWILIO_AUTH_TOKEN: z.string().min(1),
  /**
   * Sender en E.164. Es insumo del hash en modo sombra: si difiere del
   * `TWILIO_FROM_NUMBER` del api, la sombra diverge (deriva de config).
   */
  TWILIO_FROM_NUMBER: z.string().regex(/^\+\d+$/),

  MAX_MESSAGES_IN_FLIGHT: z
    .string()
    .default('10')
    .transform((s) => Number.parseInt(s, 10))
    .pipe(z.number().int().min(1).max(100)),

  /** Health probe HTTP; Cloud Run inyecta PORT. */
  PORT: z
    .string()
    .default('8080')
    .transform((s) => Number.parseInt(s, 10))
    .pipe(z.number().int().min(1).max(65535)),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  NODE_ENV: z.enum(['development', 'production', 'staging', 'test']).default('production'),
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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new InvalidConfigError(
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return parsed.data;
}
