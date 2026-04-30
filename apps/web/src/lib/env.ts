import { z } from 'zod';

/**
 * Env vars del cliente web. Vite expone con prefijo VITE_ las que están en
 * `.env*` files al `import.meta.env`.
 *
 * Validamos al startup — si algo falta, mejor que la app no arranque que
 * fallar runtime en producción con error críptico.
 */
const envSchema = z.object({
  VITE_FIREBASE_API_KEY: z.string().min(1, 'VITE_FIREBASE_API_KEY required'),
  VITE_FIREBASE_AUTH_DOMAIN: z.string().min(1, 'VITE_FIREBASE_AUTH_DOMAIN required'),
  VITE_FIREBASE_PROJECT_ID: z.string().min(1, 'VITE_FIREBASE_PROJECT_ID required'),
  VITE_FIREBASE_APP_ID: z.string().min(1, 'VITE_FIREBASE_APP_ID required'),
  VITE_FIREBASE_STORAGE_BUCKET: z.string().optional(),
  VITE_FIREBASE_MESSAGING_SENDER_ID: z.string().optional(),

  /**
   * URL del API. En desarrollo apunta al api local (puerto 8080),
   * en prod a https://api.boosterchile.com. Sin trailing slash.
   */
  VITE_API_URL: z
    .string()
    .url('VITE_API_URL must be a full URL')
    .refine((url) => !url.endsWith('/'), 'VITE_API_URL must not end with slash'),
});

export type Env = z.infer<typeof envSchema>;

const result = envSchema.safeParse(import.meta.env);
if (!result.success) {
  // En desarrollo Vite muestra esto en consola, en prod la build falla antes.
  console.error('[env] Invalid environment configuration', result.error.flatten());
  throw new Error('Invalid env — check VITE_* vars in .env or .env.local');
}

export const env: Env = result.data;
