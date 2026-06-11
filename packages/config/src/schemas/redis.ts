import { z } from 'zod';
import { booleanFlag } from '../booleanFlag.js';

export const redisEnvSchema = z.object({
  REDIS_HOST: z.string().min(1),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  // booleanFlag (NO z.coerce.boolean): "false" debe parsear false —
  // auditoría 2026-06-09; mismo footgun corregido en apps/api 2026-05-13.
  REDIS_TLS: booleanFlag(false),
  // PEM del server CA de Memorystore (transitEncryptionMode SERVER_AUTHENTICATION).
  // El cert lo firma una CA privada por-instancia que NO está en el bundle público
  // del sistema; sin pinnearla, ioredis falla con UNABLE_TO_VERIFY_LEAF_SIGNATURE.
  // Opcional: dev local corre sin TLS. Ver apps/api/src/lib/redis-tls.ts.
  REDIS_CA_CERT: z.string().optional(),
});

export type RedisEnv = z.infer<typeof redisEnvSchema>;
