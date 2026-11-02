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
 *
 * Los mensajes los define cada schema (en español, TRK-005). Ningún issue de
 * formato (`invalid_format`) expone `pattern` (la regex interna) en el body 400.
 */
import { type Hook, zValidator as honoZValidator } from '@hono/zod-validator';

type IssueBody = { code?: unknown; pattern?: unknown };
const sinPattern = (i: unknown) => {
  const { pattern: _p, ...resto } = i as IssueBody;
  return (i as IssueBody).code === 'invalid_format' ? resto : i;
};

/** Issues aptos para un body 400 público: sin `pattern` (TRK-006, para 400 armados fuera de zValidator). */
export const issuesPublicos = (issues: readonly unknown[]) => issues.map(sinPattern);

export function zodErrorBody(error: { issues: unknown[]; name: string }) {
  return {
    success: false as const,
    error: { issues: issuesPublicos(error.issues), name: error.name },
  };
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
