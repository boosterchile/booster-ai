import { z } from 'zod';

/**
 * Config del worker TED (`document-service`, frente F4-4b). Todo input externo
 * (env) pasa por Zod al startup (boundary). El servicio se rehúsa a arrancar
 * con config inválida.
 */
const envSchema = z
  .object({
    DATABASE_URL: z.string().url(),
    GOOGLE_CLOUD_PROJECT: z.string().min(1),

    /**
     * Cómo llega `document.uploaded` (ADR-085). Lo fija Terraform
     * (`var.document_service_push`, compute.tf) junto con la suscripción:
     *
     *   - `pull`: el worker abre StreamingPull. Necesita `min_instances=1` y
     *     CPU siempre asignada.
     *   - `push`: Pub/Sub hace POST a `/pubsub/document-uploaded` y el servicio
     *     escala a cero. No se abre StreamingPull.
     *
     * Default `pull`: una imagen nueva desplegada antes del apply se comporta
     * igual que la anterior.
     */
    DOCUMENT_CONSUMER_MODE: z.enum(['pull', 'push']).default('pull'),

    /**
     * Email del SA con el que Pub/Sub firma el OIDC del push
     * (`document-push-invoker`, messaging.tf). Con él configurado, el endpoint
     * push queda activo en ambos modos: así no importa si la suscripción pasa a
     * push antes o después de la revisión nueva. Sin él, el endpoint responde 404.
     */
    PUSH_CALLER_SA: z.string().email().optional(),

    /**
     * `aud` que debe traer el OIDC del push: `local.cloud_run_document_url`
     * (compute.tf), que la suscripción usa como audience y el servicio declara
     * como custom audience. Va junto con PUSH_CALLER_SA.
     */
    PUSH_OIDC_AUDIENCE: z.string().url().optional(),

    /** Subscription del topic `document.uploaded` (messaging.tf). Solo la usa el modo pull. */
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
     * Mensajes en paralelo en modo pull. El decode (rasterizar PDF + PDF417) es
     * pesado; mantener bajo para no saturar memoria del worker. En modo push el
     * tope lo pone Cloud Run (`max_instance_request_concurrency`, compute.tf).
     */
    MAX_MESSAGES_IN_FLIGHT: z
      .string()
      .default('5')
      .transform((s) => Number.parseInt(s, 10))
      .pipe(z.number().int().min(1).max(100)),

    /** Puerto HTTP: `/health` (probes de Cloud Run) y el endpoint push. */
    HEALTH_PORT: z
      .string()
      .default('8080')
      .transform((s) => Number.parseInt(s, 10))
      .pipe(z.number().int().min(1).max(65535)),

    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  })
  .superRefine((env, ctx) => {
    const hasSa = env.PUSH_CALLER_SA !== undefined;
    const hasAudience = env.PUSH_OIDC_AUDIENCE !== undefined;
    // En modo push, sin el emisor y el aud esperados no hay forma de
    // autenticar a Pub/Sub: el worker no arranca en vez de rechazar cada
    // mensaje.
    if (env.DOCUMENT_CONSUMER_MODE === 'push' && !(hasSa && hasAudience)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [hasSa ? 'PUSH_OIDC_AUDIENCE' : 'PUSH_CALLER_SA'],
        message:
          'PUSH_CALLER_SA y PUSH_OIDC_AUDIENCE son obligatorios con DOCUMENT_CONSUMER_MODE=push',
      });
      return;
    }
    // Uno sin el otro dejaría el endpoint push a medio configurar.
    if (hasSa !== hasAudience) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [hasSa ? 'PUSH_OIDC_AUDIENCE' : 'PUSH_CALLER_SA'],
        message: 'PUSH_CALLER_SA y PUSH_OIDC_AUDIENCE van juntos',
      });
    }
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
