import { z } from 'zod';

export const firebaseEnvSchema = z.object({
  FIREBASE_PROJECT_ID: z.string().min(1),
  /**
   * Path a service-account JSON o contenido inline via GOOGLE_APPLICATION_CREDENTIALS.
   * En Cloud Run: ADC. En dev: archivo local referenciado por env var.
   */
  FIREBASE_STORAGE_BUCKET: z.string().optional(),
});

export type FirebaseEnv = z.infer<typeof firebaseEnvSchema>;
