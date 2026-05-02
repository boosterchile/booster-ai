import { z } from 'zod';

/**
 * Config del telemetry-tcp-gateway. Validada con zod al startup —
 * si falta algo, el container revienta antes de servir tráfico
 * (mejor que ENOENT a las 3 AM).
 */
const envSchema = z.object({
  /**
   * Puerto TCP donde el gateway escucha conexiones de devices Teltonika.
   * Default 5027 (puerto registrado IANA tipo Teltonika; cualquier puerto
   * libre alcanza siempre que coincida con el config del device).
   */
  PORT: z
    .string()
    .default('5027')
    .transform((s) => Number.parseInt(s, 10))
    .pipe(z.number().int().min(1).max(65535)),

  /**
   * URL de Postgres. Para Cloud SQL via VPC connector usar:
   *   postgresql://user:pass@10.x.x.x:5432/booster_ai?sslmode=disable
   * El sslmode=disable es OK en VPC privado.
   */
  DATABASE_URL: z.string().url(),

  /** GCP project ID para Pub/Sub. */
  GOOGLE_CLOUD_PROJECT: z.string().min(1),

  /**
   * Nombre del topic de Pub/Sub donde publicamos los AVL records.
   * El processor (apps/telemetry-processor) los consume desde su sub.
   */
  PUBSUB_TOPIC_TELEMETRY: z.string().default('telemetry-events'),

  /**
   * Timeout (segundos) para conexiones idle. Si un device no manda
   * nada por este tiempo, lo desconectamos para liberar recursos.
   * El device reconecta automáticamente.
   */
  IDLE_TIMEOUT_SEC: z
    .string()
    .default('300')
    .transform((s) => Number.parseInt(s, 10))
    .pipe(z.number().int().min(30).max(3600)),

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
