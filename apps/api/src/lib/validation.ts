/**
 * Validador común de la API (TRK-003).
 *
 * Envuelve `zValidator` de `@hono/zod-validator` con un hook por defecto que
 * emite el contrato público de 400: `{ success: false, error: { issues, name } }`.
 * Es el mismo body que produce hoy el default de la librería con zod 3. Con zod 4
 * el default cambia (`error` se serializa como `{ name, message }`), así que fijarlo
 * acá mantiene el contrato tras el bump.
 *
 * Las rutas importan `zValidator` desde aquí, nunca desde `@hono/zod-validator`.
 * Si se pasa un hook explícito, se usa ese tal cual (mismo comportamiento que antes).
 */
import { type Hook, zValidator as honoZValidator } from '@hono/zod-validator';

// biome-ignore lint/suspicious/noExplicitAny: hook genérico para cualquier schema/target.
const defaultHook: Hook<any, any, any> = (result, c) => {
  if (!result.success) {
    return c.json(
      { success: false, error: { issues: result.error.issues, name: result.error.name } },
      400,
    );
  }
  return undefined;
};

export const zValidator: typeof honoZValidator = ((...args: Parameters<typeof honoZValidator>) => {
  const [target, schema, hook, options] = args;
  return honoZValidator(target, schema, hook ?? defaultHook, options);
}) as typeof honoZValidator;
