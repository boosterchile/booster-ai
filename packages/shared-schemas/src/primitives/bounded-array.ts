import { z } from 'zod';

/**
 * Arreglo de entrada con tope de largo que se comprueba ANTES que los elementos.
 *
 * En zod 3, `.max()` se evalúa después de validar cada elemento, así que un
 * arreglo demasiado largo se recorre entero igual. Este helper compara el largo
 * en un `z.preprocess` y, si pasa el tope, corta con un único issue `too_big`
 * (el mismo que produce `.max()`), sin tocar los elementos. Dentro del tope,
 * valida con el esquema base más `.max(max)`.
 *
 * Usarlo en todo arreglo de un esquema de entrada (cuerpo HTTP, mensajes). Al
 * migrar a zod 4 se reemplaza por `.max()`, que ahí sí corta antes
 * (`.specs/_followups/zod-4-migracion-2026-10.md`).
 *
 * @param array esquema base, con sus propias restricciones (`.min()`, mensajes).
 * @param max   largo máximo, entero no negativo.
 */
export function boundedArray<T extends z.ZodTypeAny, C extends z.ArrayCardinality>(
  array: z.ZodArray<T, C>,
  max: number,
) {
  if (!Number.isInteger(max) || max < 0) {
    throw new RangeError(`boundedArray: el tope debe ser un entero no negativo (recibido ${max})`);
  }
  const conTope = array.max(max);
  return z.preprocess((valor, ctx) => {
    if (Array.isArray(valor) && valor.length > max) {
      ctx.addIssue({
        code: z.ZodIssueCode.too_big,
        type: 'array',
        maximum: max,
        inclusive: true,
        exact: false,
        message: `Array must contain at most ${max} element(s)`,
        // `fatal` aborta antes de que el esquema base valide los elementos.
        fatal: true,
      });
      return z.NEVER;
    }
    return valor;
  }, conTope);
}
