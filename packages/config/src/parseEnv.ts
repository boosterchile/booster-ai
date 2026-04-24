import type { z } from 'zod';

export type EnvSchema<T> = z.ZodType<T>;

/**
 * Parsea `process.env` contra un schema Zod. Si falla, logea el error
 * estructurado a stderr y detiene el proceso con exit code 1.
 *
 * Este comportamiento es intencional: preferimos crash al arranque que
 * servidor corriendo con config inválida.
 */
export function parseEnv<T>(schema: EnvSchema<T>, source: NodeJS.ProcessEnv = process.env): T {
  const result = schema.safeParse(source);
  if (!result.success) {
    // stderr directo — no usamos logger aquí para evitar dep circular
    const errors = result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    process.stderr.write(
      `${JSON.stringify(
        {
          level: 'fatal',
          message: 'Invalid environment configuration. Refusing to start.',
          errors,
        },
        null,
        2,
      )}\n`,
    );
    // eslint-disable-next-line no-process-exit
    process.exit(1);
  }
  return result.data;
}
