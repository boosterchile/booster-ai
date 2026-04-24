import { z } from 'zod';

/**
 * Schema base que aplica a TODOS los servicios del monorepo.
 * Cada app debe extender esto con sus schemas específicos.
 */
export const commonEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production', 'test']),
  PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  SERVICE_NAME: z.string().min(1),
  SERVICE_VERSION: z.string().default('0.0.0-dev'),
});

export type CommonEnv = z.infer<typeof commonEnvSchema>;
