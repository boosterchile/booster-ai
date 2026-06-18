import { z } from 'zod';

/**
 * Env de apps/marketing. Solo vars `NEXT_PUBLIC_*` (Next las inlina en el
 * bundle cliente en build time, por eso se referencian de forma literal).
 *
 * - `NEXT_PUBLIC_API_URL`: base del api (para el POST a signup-request).
 *   Opcional: el contenido/SEO no la necesita; el form sí (T5) y falla con
 *   gracia si falta.
 * - `NEXT_PUBLIC_SIGNUP_ENABLED`: kill-switch del `/signup` funcional.
 *   **Fail-closed**: solo el literal `"true"` habilita; undefined / "false" /
 *   cualquier otro valor → deshabilitado. (ver `.specs/.../spec.md` §SC8.)
 */
const marketingEnvSchema = z.object({
  NEXT_PUBLIC_API_URL: z.string().url().optional(),
  NEXT_PUBLIC_SIGNUP_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
});

export interface MarketingEnv {
  apiUrl: string | undefined;
  signupEnabled: boolean;
}

export function loadMarketingEnv(): MarketingEnv {
  // Referencias literales a `process.env.NEXT_PUBLIC_*`: Next las reemplaza
  // por el valor en build time; un acceso dinámico no se inlinearía.
  const parsed = marketingEnvSchema.safeParse({
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_SIGNUP_ENABLED: process.env.NEXT_PUBLIC_SIGNUP_ENABLED,
  });
  if (!parsed.success) {
    const fields = Object.keys(parsed.error.flatten().fieldErrors).join(', ');
    throw new Error(`Env de marketing inválida (revisa NEXT_PUBLIC_*): ${fields}`);
  }
  return {
    apiUrl: parsed.data.NEXT_PUBLIC_API_URL,
    signupEnabled: parsed.data.NEXT_PUBLIC_SIGNUP_ENABLED,
  };
}

/** Helper para el gate de `/signup` (T4). */
export function isSignupEnabled(): boolean {
  return loadMarketingEnv().signupEnabled;
}
