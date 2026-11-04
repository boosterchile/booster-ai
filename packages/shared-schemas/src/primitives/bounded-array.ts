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
export function boundedArray<T extends z.ZodType>(array: z.ZodArray<T>, max: number) {
  if (!Number.isInteger(max) || max < 0) {
    throw new RangeError(`boundedArray: el tope debe ser un entero no negativo (recibido ${max})`);
  }
  const conTope = array.max(max);
  return z.preprocess((valor, ctx) => {
    if (Array.isArray(valor) && valor.length > max) {
      ctx.addIssue({
        code: 'too_big',
        origin: 'array',
        maximum: max,
        inclusive: true,
        input: valor,
        // Sin `message`: zod genera el mismo texto que `.max()`. Un issue en el
        // preprocess corta el pipe antes de validar los elementos.
        continue: false,
      });
      return z.NEVER;
    }
    return valor;
  }, conTope);
}
