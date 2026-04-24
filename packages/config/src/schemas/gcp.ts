import { z } from 'zod';

export const gcpEnvSchema = z.object({
  GOOGLE_CLOUD_PROJECT: z.string().min(1),
  /**
   * Ruta absoluta al archivo JSON de service account.
   * Opcional porque en Cloud Run se usa metadata server (ADC).
   * Requerido en dev local.
   */
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
});

export type GcpEnv = z.infer<typeof gcpEnvSchema>;
