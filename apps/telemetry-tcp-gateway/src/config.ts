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
   * Topic Pub/Sub donde publicamos el packet COMPLETO de un Crash Trace
   * (Wave 2 B3) para forensics. Cuando el device manda eventIoId=247
   * priority=panic, el gateway publica todo el packet (~1000 records)
   * a este topic; el processor lo guarda en GCS + BigQuery.
   *
   * Default vacío deshabilita el publish (envs sin bucket configurado).
   */
  PUBSUB_TOPIC_CRASH_TRACES: z.string().default(''),

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

  // -------------------------------------------------------------------------
  // Wave 3 — TLS endpoint (Track D3)
  // -------------------------------------------------------------------------

  /**
   * Puerto TCP TLS-encrypted al que migraremos los devices en Wave 3.
   * Listening dual durante la migración: 5027 plain (existente) + 5061
   * TLS (nuevo). Cuando todos los devices estén en Wave 3, podemos
   * apagar el plain port via deploy.
   *
   * Default 5061 = puerto Teltonika TLS estándar.
   */
  TLS_PORT: z
    .string()
    .default('5061')
    .transform((s) => Number.parseInt(s, 10))
    .pipe(z.number().int().min(1).max(65535)),

  /**
   * Path en disco al cert TLS. cert-manager renueva via Let's Encrypt
   * cada 60-90 días y monta el resultado como Secret K8s en este path.
   * Vacío deshabilita el listener TLS (envs sin cert configurado).
   */
  TLS_CERT_PATH: z.string().default(''),

  /** Path en disco a la private key TLS (montada por cert-manager Secret). */
  TLS_KEY_PATH: z.string().default(''),

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
