import { z } from 'zod';

/**
 * Config del worker TED (`document-service`, frente F4-4b). Todo input externo
 * (env) pasa por Zod al startup (boundary). El servicio se rehúsa a arrancar
 * con config inválida.
 */
const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  GOOGLE_CLOUD_PROJECT: z.string().min(1),

  /** Subscription pull del topic `document.uploaded` (messaging.tf). */
  PUBSUB_SUBSCRIPTION_DOCUMENT_UPLOADED: z.string().default('document-uploaded-processor-sub'),

  /**
   * Bucket GCS donde 4a archivó el documento (objeto = `file_path`). El worker
   * lee con el MISMO nombre de env que `compute.tf` (módulo `service_document`)
   * ya inyecta: `DOCUMENTS_BUCKET = google_storage_bucket.documents.name`. Es
   * el mismo bucket físico al que `apps/api` (4a) sube. Usar otro nombre dejaba
   * al worker sin bootear (env ausente → InvalidConfigError al startup).
   */
  DOCUMENTS_BUCKET: z.string().min(1),

  /**
   * Mensajes en paralelo. El decode (rasterizar PDF + PDF417) es pesado;
   * mantener bajo para no saturar memoria del worker.
   */
  MAX_MESSAGES_IN_FLIGHT: z
    .string()
    .default('5')
    .transform((s) => Number.parseInt(s, 10))
    .pipe(z.number().int().min(1).max(100)),

  /** Health probe HTTP para liveness de Cloud Run. */
  HEALTH_PORT: z
    .string()
    .default('8080')
    .transform((s) => Number.parseInt(s, 10))
    .pipe(z.number().int().min(1).max(65535)),

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
