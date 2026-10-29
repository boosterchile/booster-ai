import { describe, expect, it } from 'vitest';
import { COMUNAS_CHILE } from '../primitives/comunas-chile.js';
import { zoneCreateBodySchema, zoneUpdateBodySchema } from './zone.js';

const TOPE = COMUNAS_CHILE.length;
const todasLasComunas = COMUNAS_CHILE.map((comuna) => comuna.code);

describe('comuna_codes: tope de largo', () => {
  it('el tope es la cantidad de comunas del catálogo', () => {
    expect(TOPE).toBe(346);
  });

  describe.each([
    ['zoneCreateBodySchema', zoneCreateBodySchema, { region_code: 'XIII', zone_type: 'ambos' }],
    ['zoneUpdateBodySchema', zoneUpdateBodySchema, {}],
  ] as const)('%s', (_nombre, schema, base) => {
    it('acepta tantas comunas como tiene el catálogo', () => {
      const result = schema.safeParse({ ...base, comuna_codes: todasLasComunas });
      expect(result.success).toBe(true);
    });

    it('rechaza más comunas que las del catálogo', () => {
      const result = schema.safeParse({
        ...base,
        comuna_codes: [...todasLasComunas, '13101'],
      });
      expect(result.success).toBe(false);
      expect(result.error?.issues).toEqual([
        expect.objectContaining({ code: 'too_big', maximum: TOPE, path: ['comuna_codes'] }),
      ]);
    });

    it('comprueba el largo antes que los elementos: un solo issue', () => {
      const result = schema.safeParse({
        ...base,
        comuna_codes: Array.from({ length: TOPE + 1 }, () => 0),
      });
      expect(result.success).toBe(false);
      expect(result.error?.issues).toHaveLength(1);
    });

    it('sigue validando los elementos dentro del tope', () => {
      const result = schema.safeParse({ ...base, comuna_codes: ['13101', ''] });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(['comuna_codes', 1]);
    });

    it('acepta null (toda la región)', () => {
      expect(schema.safeParse({ ...base, comuna_codes: null }).success).toBe(true);
    });
  });

  it('el alta acepta comuna_codes omitido', () => {
    expect(
      zoneCreateBodySchema.safeParse({ region_code: 'XIII', zone_type: 'ambos' }).success,
    ).toBe(true);
  });
});
