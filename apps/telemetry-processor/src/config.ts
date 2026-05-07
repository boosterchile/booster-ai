import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  GOOGLE_CLOUD_PROJECT: z.string().min(1),

  /** Subscription Pub/Sub que consume del topic telemetry-events. */
  PUBSUB_SUBSCRIPTION_TELEMETRY: z.string().default('telemetry-events-processor-sub'),

  /**
   * Subscription Pub/Sub del topic crash-traces (Wave 2 B3).
   * El gateway publica el packet completo (~1000+ records) cuando detecta
   * un Crash event; el processor lo persiste en GCS + BigQuery.
   */
  PUBSUB_SUBSCRIPTION_CRASH_TRACES: z.string().default('crash-traces-processor-sub'),

  /**
   * GCS bucket name para Crash Traces serializados. Dejarlo vacío
   * deshabilita el consumer (útil para envs locales / staging sin
   * crash-traces).
   */
  GCS_CRASH_TRACES_BUCKET: z.string().default(''),

  /** Dataset BigQuery donde vive `crash_events` (ADR-005: telemetry). */
  BIGQUERY_CRASH_DATASET: z.string().default('telemetry'),

  /** Tabla BigQuery dentro del dataset. */
  BIGQUERY_CRASH_TABLE: z.string().default('crash_events'),

  /**
   * Mensajes a procesar en paralelo. Pub/Sub flow control. Más alto
   * = más throughput pero más memoria y carga DB. 50-100 es balance OK
   * para piloto.
   */
  MAX_MESSAGES_IN_FLIGHT: z
    .string()
    .default('50')
    .transform((s) => Number.parseInt(s, 10))
    .pipe(z.number().int().min(1).max(1000)),

  /**
   * Health probe HTTP. Cloud Run necesita endpoint /health en puerto
   * para liveness. El processor expone uno mínimo.
   */
  HEALTH_PORT: z
    .string()
    .default('8080')
    .transform((s) => Number.parseInt(s, 10))
    .pipe(z.number().int().min(1).max(65535)),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(): Config {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify(
        {
          level: 'fatal',
          message: 'Invalid environment configuration. Refusing to start.',
          errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }
  return parsed.data;
}
