/**
 * Validador común de la API (TRK-003).
 *
 * Envuelve `zValidator` de `@hono/zod-validator` para que todo 400 de
 * validación emita el contrato público `{ success: false, error: { issues, name } }`.
 * Con zod 4 el default de la librería serializa `error` como `{ name, message }`,
 * así que el body se arma acá con `zodErrorBody`.
 *
 * Las rutas importan `zValidator` desde aquí, nunca desde `@hono/zod-validator`.
 * Si se pasa un hook explícito, corre primero; si no responde y el input es
 * inválido, se responde el body común.
 */
import { type Hook, zValidator as honoZValidator } from '@hono/zod-validator';

export function zodErrorBody(error: { issues: unknown[]; name: string }) {
  return { success: false as const, error: { issues: error.issues, name: error.name } };
}

// biome-ignore lint/suspicious/noExplicitAny: hook genérico para cualquier schema/target.
type AnyHook = Hook<any, any, any>;

const withDefault =
  (hook?: AnyHook): AnyHook =>
  async (result, c) => {
    const custom = hook ? await hook(result, c) : undefined;
    if (custom) {
      return custom;
    }
    if (!result.success) {
      return c.json(zodErrorBody(result.error), 400);
    }
    return undefined;
  };

export const zValidator: typeof honoZValidator = ((...args: Parameters<typeof honoZValidator>) => {
  const [target, schema, hook, options] = args;
  return honoZValidator(target, schema, withDefault(hook), options);
}) as typeof honoZValidator;
