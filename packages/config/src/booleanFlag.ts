import { z } from 'zod';

/**
 * Parsea env var boolean correctamente. `z.coerce.boolean()` es un footgun:
 * coercea CUALQUIER string non-empty a `true`, incluyendo "false".
 *
 * Bug original 2026-05-13 en apps/api (WAKE_WORD_VOICE_ACTIVATED="false" →
 * true); el mismo footgun vivía en `redisEnvSchema.REDIS_TLS` de este
 * package compartido (auditoría 2026-06-09, riesgo medio) — un servicio
 * que seteara `REDIS_TLS=false` activaba TLS.
 *
 * Mapea explícitamente: "true"/"1" → true; "false"/"0"/"" → false;
 * cualquier otro valor (incluido undefined) → defaultValue.
 */
export function booleanFlag(defaultValue: boolean) {
  return z
    .preprocess((v) => {
      if (typeof v === 'boolean') {
        return v;
      }
      if (typeof v !== 'string') {
        return defaultValue;
      }
      const normalized = v.trim().toLowerCase();
      if (normalized === 'true' || normalized === '1') {
        return true;
      }
      if (normalized === 'false' || normalized === '0' || normalized === '') {
        return false;
      }
      return defaultValue;
    }, z.boolean())
    .default(defaultValue);
}
