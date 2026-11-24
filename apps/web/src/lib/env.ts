import { z } from 'zod';
import { logger } from './logger.js';

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

  /**
   * Google Maps JS API key para mostrar mapas en /vehiculos/:id y
   * /cargas/:id. Optional para que dev sin key arranque (los mapas
   * caen al fallback "no configurado").
   */
  VITE_GOOGLE_MAPS_API_KEY: z.string().optional(),

  /**
   * Site key de reCAPTCHA (pública) para Firebase App Check: la del proveedor
   * que indique `VITE_APPCHECK_PROVIDER`. Required: App Check es un control de
   * seguridad, no opcional como los mapas — si falta, preferimos que el
   * build/boot falle antes que shippear sin attestation.
   * En dev se define en `.env.local`; en prod la inyecta cloudbuild como VITE_*.
   */
  VITE_RECAPTCHA_SITE_KEY: z.string().min(1, 'VITE_RECAPTCHA_SITE_KEY required'),

  /**
   * Proveedor de attestation de App Check, elegido por entorno en el build
   * (.specs/app-check-fraud-defense). `recaptcha-v3` es reCAPTCHA clásico, que
   * Google declaró obsoleto y ya no deja registrar en apps nuevas;
   * `recaptcha-enterprise` es Fraud Defense. Ausente o vacía (un build-arg sin
   * valor llega como string vacío) = `recaptcha-v3`, el proveedor con el que
   * está registrada la app de prod. Un valor desconocido hace fallar el boot.
   */
  VITE_APPCHECK_PROVIDER: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.enum(['recaptcha-v3', 'recaptcha-enterprise']).default('recaptcha-v3'),
  ),

  /**
   * DSN de Sentry (público por diseño, como las keys de Firebase; ADR-074).
   * Vacío/ausente = sink de errores deshabilitado (no-op) — dev y CI corren
   * así. En prod lo inyecta cloudbuild como las demás VITE_*.
   */
  VITE_SENTRY_DSN: z.string().optional(),

  /**
   * Release para correlar issues Sentry ↔ deploy (ADR-074). cloudbuild lo
   * inyecta con el commit SHA; en dev queda ausente.
   */
  VITE_RELEASE: z.string().optional(),

  /**
   * Cablea `connectAuthEmulator` al Auth emulator local (Slot 3 paso 6).
   * Default OFF. Anti-footgun: `"false"` no puede parsear true
   * (`z.coerce.boolean` lo haría). Nunca se setea en Cloud Build / prod.
   * Con ON, el cliente NO pega Identity Platform: solo loopback.
   */
  VITE_USE_AUTH_EMULATOR: z
    .preprocess((v) => {
      if (typeof v === 'boolean') {
        return v;
      }
      if (typeof v !== 'string') {
        return false;
      }
      const normalized = v.trim().toLowerCase();
      if (normalized === 'true' || normalized === '1') {
        return true;
      }
      return false;
    }, z.boolean())
    .default(false),

  /**
   * Origin del Auth emulator. Solo se usa con `VITE_USE_AUTH_EMULATOR=true`.
   * Default `http://127.0.0.1:9099`. Host no-loopback → throw en boot.
   */
  VITE_AUTH_EMULATOR_URL: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

const result = envSchema.safeParse(import.meta.env);
if (!result.success) {
  // En desarrollo Vite muestra esto en consola, en prod la build falla antes.
  logger.error({ issues: z.flattenError(result.error) }, '[env] Invalid environment configuration');
  throw new Error('Invalid env — check VITE_* vars in .env or .env.local');
}

export const env: Env = result.data;
