import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { MENSAJE_ERROR_GENERICO, erroresPorCampo } from './form-validation.js';

// Nit 1 QA #866: la heurística de inglés contra los textos por defecto REALES de zod 4.
describe('erroresPorCampo — defaults de zod 4 → genérico', () => {
  const casos: [string, z.ZodType, unknown][] = [
    ['tipo', z.string(), 1],
    ['requerido', z.string(), undefined],
    ['too_small', z.string().min(3), 'a'],
    ['too_big', z.number().max(1), 5],
    ['email', z.email(), 'x'],
    ['enum', z.enum(['a', 'b']), 'c'],
    ['regex', z.string().regex(/^\d+$/), 'x'],
    ['url', z.url(), 'x'],
  ];
  it.each(casos)('%s', (_c, schema, valor) => {
    const r = z.object({ f: schema }).safeParse({ f: valor });
    expect(r.success).toBe(false);
    const details = { error: { issues: r.error?.issues } };
    expect(erroresPorCampo(details, ['f'])).toEqual({ f: MENSAJE_ERROR_GENERICO });
  });

  it('unrecognized key (strict)', () => {
    const r = z.strictObject({ f: z.string() }).safeParse({ f: 'a', g: 1 });
    const issues = (r.error?.issues ?? []).map((i) => ({ ...i, path: ['f'] }));
    expect(erroresPorCampo({ error: { issues } }, ['f'])).toEqual({ f: MENSAJE_ERROR_GENERICO });
  });
});
