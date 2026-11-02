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
 * D2: los mensajes por defecto de zod 4 se reescriben al texto de zod 3 (el que
 * ve la web como `path: message`) con un error map por parse, solo en este
 * validador HTTP. Los mensajes propios de cada schema tienen prioridad y no cambian.
 */
import { type Hook, zValidator as honoZValidator } from '@hono/zod-validator';

export function zodErrorBody(error: { issues: unknown[]; name: string }) {
  return { success: false as const, error: { issues: error.issues, name: error.name } };
}

type Issue = { code: string; input?: unknown; [k: string]: unknown };
const q = (v: unknown) => `'${String(v)}'`;
const tipo = (v: unknown) =>
  v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isNaN(v) ? 'nan' : typeof v;
const UNIDAD: Record<string, [string, string]> = {
  string: ['String', 'character(s)'],
  array: ['Array', 'element(s)'],
};

// Borrar cuando la web deje de depender de los textos de zod 3 (TRK-003 D2).
/** Texto por defecto de zod 3 para un issue de zod 4; `undefined` = default de zod 4. */
export function mensajeZod3(iss: Issue): string | undefined {
  const { code, input } = iss;
  if (input === undefined && (code === 'invalid_type' || code === 'invalid_value')) {
    return 'Required';
  }
  if (code === 'invalid_type') {
    return `Expected ${iss.expected}, received ${tipo(input)}`;
  }
  if (code === 'invalid_value' && Array.isArray(iss.values)) {
    return `Invalid enum value. Expected ${iss.values.map(q).join(' | ')}, received ${q(input)}`;
  }
  if (code === 'too_small' || code === 'too_big') {
    const min = code === 'too_small';
    const n = min ? iss.minimum : iss.maximum;
    const u = UNIDAD[String(iss.origin)];
    if (u) {
      return `${u[0]} must contain ${min ? 'at least' : 'at most'} ${n} ${u[1]}`;
    }
    if (iss.origin === 'number') {
      return `Number must be ${min ? 'greater' : 'less'} than ${iss.inclusive ? 'or equal to ' : ''}${n}`;
    }
  }
  return undefined;
}

const zod3Texts = {
  validationFunction: (
    schema: { safeParseAsync: (v: unknown, p: unknown) => unknown },
    v: unknown,
  ) => schema.safeParseAsync(v, { error: mensajeZod3 }),
};

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
  return honoZValidator(target, schema, withDefault(hook), options ?? (zod3Texts as never));
}) as typeof honoZValidator;
