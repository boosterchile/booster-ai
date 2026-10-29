import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { boundedArray } from './bounded-array.js';

const codigos = boundedArray(z.array(z.string().min(1)), 3);

describe('boundedArray', () => {
  it('acepta un arreglo dentro del tope', () => {
    expect(codigos.parse(['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('acepta un arreglo vacío si el esquema base lo permite', () => {
    expect(codigos.parse([])).toEqual([]);
  });

  it('valida los elementos cuando el largo está dentro del tope', () => {
    const result = codigos.safeParse(['a', '', 3]);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path)).toEqual([[1], [2]]);
  });

  it('rechaza un arreglo más largo que el tope', () => {
    const result = codigos.safeParse(['a', 'b', 'c', 'd']);
    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([
      expect.objectContaining({
        code: 'too_big',
        type: 'array',
        maximum: 3,
        inclusive: true,
        path: [],
      }),
    ]);
  });

  it('comprueba el largo antes que los elementos: un solo issue', () => {
    const result = codigos.safeParse([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(result.success).toBe(false);
    expect(result.error?.issues).toHaveLength(1);
    expect(result.error?.issues[0]?.code).toBe('too_big');
  });

  it('usa el mismo mensaje que .max() de zod', () => {
    const conMax = z.array(z.string()).max(3).safeParse(['a', 'b', 'c', 'd']);
    const acotado = codigos.safeParse(['a', 'b', 'c', 'd']);
    expect(acotado.error?.issues[0]?.message).toBe(conMax.error?.issues[0]?.message);
  });

  it('conserva las restricciones del esquema base', () => {
    const almenosUno = boundedArray(z.array(z.string()).min(1, 'al menos uno'), 3);
    const result = almenosUno.safeParse([]);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('al menos uno');
  });

  it('deja que el esquema base reporte un tipo que no es arreglo', () => {
    const result = codigos.safeParse('a,b');
    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([
      expect.objectContaining({ code: 'invalid_type', expected: 'array' }),
    ]);
  });

  it('se puede envolver en nullable y optional', () => {
    const campo = z.object({ codigos: codigos.nullable().optional() });
    expect(campo.parse({ codigos: null })).toEqual({ codigos: null });
    expect(campo.parse({})).toEqual({});
    expect(campo.safeParse({ codigos: ['a', 'b', 'c', 'd'] }).error?.issues).toHaveLength(1);
  });

  it('exige un tope entero no negativo', () => {
    expect(() => boundedArray(z.array(z.string()), -1)).toThrow(RangeError);
    expect(() => boundedArray(z.array(z.string()), 1.5)).toThrow(RangeError);
  });
});
