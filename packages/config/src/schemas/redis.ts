import { z } from 'zod';

export const redisEnvSchema = z.object({
  REDIS_HOST: z.string().min(1),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_TLS: z.coerce.boolean().default(false),
});

export type RedisEnv = z.infer<typeof redisEnvSchema>;
