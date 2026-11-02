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
const corto = (v: string) => (v.length > 100 ? `${v.slice(0, 100)}…` : v);
const q = (v: unknown) => (typeof v === 'string' ? `'${corto(v)}'` : `${v}`);
const UNIDAD: Record<string, string[]> = {
  string: ['String', 'character(s)', 'over', 'under'],
  array: ['Array', 'element(s)', 'more than', 'less than'],
};
const tipo = (v: unknown) =>
  v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isNaN(v) ? 'nan' : typeof v;

// Borrar cuando la web deje de depender de los textos de zod 3 (TRK-003 D2).
// Textos verificados contra zod 3.25.76 (v3/locales/en.ts). Nunca lanza: ante error, default de zod 4.
/** Texto por defecto de zod 3 para un issue de zod 4; `undefined` = default de zod 4. */
export function mensajeZod3(iss: Issue): string | undefined {
  try {
    return textoZod3(iss);
  } catch {
    return undefined;
  }
}

function textoZod3(iss: Issue): string | undefined {
  const { code, input } = iss;
  const values = Array.isArray(iss.values) ? iss.values : [];
  if (input === undefined && (code === 'invalid_type' || code === 'invalid_value')) {
    return 'Required';
  }
  if (code === 'invalid_type' && iss.expected === 'int') {
    return typeof input === 'number'
      ? 'Expected integer, received float'
      : `Expected number, received ${tipo(input)}`;
  }
  if (code === 'invalid_type') {
    return `Expected ${iss.expected}, received ${tipo(input)}`;
  }
  if (code === 'invalid_value') {
    const opciones = values.map(q).join(' | ');
    return typeof input === 'string'
      ? `Invalid enum value. Expected ${opciones}, received ${q(input)}`
      : `Expected ${opciones}, received ${tipo(input)}`;
  }
  if (code === 'too_small' || code === 'too_big') {
    const min = code === 'too_small';
    const n = min ? iss.minimum : iss.maximum;
    const { exact, inclusive } = iss;
    const u = UNIDAD[String(iss.origin)];
    if (u) {
      const amplio = min ? ['at least', u[2]] : ['at most', u[3]];
      return `${u[0]} must contain ${exact ? 'exactly' : inclusive ? amplio[0] : amplio[1]} ${n} ${u[1]}`;
    }
    if (iss.origin === 'number') {
      return min
        ? `Number must be ${exact ? 'exactly equal to ' : inclusive ? 'greater than or equal to ' : 'greater than '}${n}`
        : `Number must be ${exact ? 'exactly' : inclusive ? 'less than or equal to' : 'less than'} ${n}`;
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
