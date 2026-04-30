import type { z } from 'zod';

/**
 * Tipo helper para callers que quieran nombrar el tipo del schema sin tener
 * que extraerlo de `z.infer`. Acepta cualquier ZodType (incluyendo schemas
 * con `.default()` que tienen input `T | undefined`).
 */
export type EnvSchema<T> = z.ZodType<T, z.ZodTypeDef, unknown>;

/**
 * Parsea `process.env` contra un schema Zod. Si falla, logea el error
 * estructurado a stderr y detiene el proceso con exit code 1.
 *
 * Este comportamiento es intencional: preferimos crash al arranque que
 * servidor corriendo con config inválida.
 *
 * Generic firma `<T extends z.ZodTypeAny>` permite que TS infiera el tipo
 * de output (con defaults aplicados) en lugar de requerir que input == output.
 */
export function parseEnv<T extends z.ZodTypeAny>(
  schema: T,
  source: NodeJS.ProcessEnv = process.env,
): z.infer<T> {
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
