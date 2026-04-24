import { z } from 'zod';

export const databaseEnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  DATABASE_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
});

export type DatabaseEnv = z.infer<typeof databaseEnvSchema>;
