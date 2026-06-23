import { z } from 'zod';

const envSchema = z.object({
  GOOGLE_CLOUD_PROJECT: z.string().min(1),

  /**
   * API key de Google Routes API para llamadas desde este servicio.
   * En Cloud Run se obtiene vía ADC (SA con permisos routes.googleapis.com).
   * La env var se mantiene por si se migra a key explícita en algún entorno.
   * Por ahora routes-api-client usa ADC directamente — este campo se
   * reserva para config futura.
   */
  GOOGLE_ROUTES_API_KEY: z.string().optional(),

  /** Subscription Pub/Sub del topic driver-positions. */
  PUBSUB_SUBSCRIPTION_DRIVER_POSITIONS: z.string().default('driver-positions-eco-routing-sub'),

  /** Subscription Pub/Sub del topic telemetry-events (posiciones Teltonika). */
  PUBSUB_SUBSCRIPTION_TELEMETRY_EVENTS: z.string().default('telemetry-events-eco-routing-sub'),

  /**
   * Mensajes a procesar en paralelo (flow control Pub/Sub).
   * Eco-routing llama a Routes API por viaje → mantener bajo para
   * controlar costos (Routes API ~$5 USD / 1000 requests).
   */
  MAX_MESSAGES_IN_FLIGHT: z
    .string()
    .default('20')
    .transform((s) => Number.parseInt(s, 10))
    .pipe(z.number().int().min(1).max(500)),

  /**
   * Cooldown mínimo entre sugerencias para el mismo viaje (segundos).
   * No más de 1 sugerencia cada N minutos.
   */
  SUGGESTION_COOLDOWN_SEGUNDOS: z
    .string()
    .default('300')
    .transform((s) => Number.parseInt(s, 10))
    .pipe(z.number().int().min(60).max(3600)),

  /**
   * Debounce de evaluación (ms): tras recibir una posición, espera este
   * tiempo antes de evaluar para agrupar updates rápidos y controlar
   * llamadas a Routes API.
   */
  EVALUATION_DEBOUNCE_MS: z
    .string()
    .default('5000')
    .transform((s) => Number.parseInt(s, 10))
    .pipe(z.number().int().min(500).max(60_000)),

  /** Health probe HTTP port (Cloud Run liveness). */
  HEALTH_PORT: z
    .string()
    .default('8080')
    .transform((s) => Number.parseInt(s, 10))
    .pipe(z.number().int().min(1).max(65535)),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),

  /**
   * Connection string para Postgres (Cloud SQL / local dev).
   * En Cloud Run se obtiene vía Cloud SQL Auth Proxy o conexión directa.
   */
  DATABASE_URL: z.string().min(1),
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
