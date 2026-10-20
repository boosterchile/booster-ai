import { describe, expect, it } from 'vitest';
import { tripRequestCreateInputSchema } from './trip-request-create.js';

function base(extra?: {
  origin?: Record<string, unknown>;
  destination?: Record<string, unknown>;
}) {
  const start = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const end = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
  return {
    origin: { address_raw: 'Compañía 4425', region_code: 'XIII', ...extra?.origin },
    destination: {
      address_raw: 'Concepción centro',
      region_code: 'VIII',
      ...extra?.destination,
    },
    cargo: { cargo_type: 'carga_seca' as const, weight_kg: 1000 },
    pickup_window: { start_at: start, end_at: end },
    proposed_price_clp: null,
  };
}

describe('tripRequestCreateInputSchema — lugar', () => {
  it('acepta Compañía 4425 y Concepción centro sin comuna ni coordenadas', () => {
    const parsed = tripRequestCreateInputSchema.parse(base());
    expect(parsed.origin.address_raw).toBe('Compañía 4425');
    expect(parsed.origin.region_code).toBe('XIII');
    expect(parsed.origin.comuna_code).toBeUndefined();
    expect(parsed.origin.latitude).toBeUndefined();
  });

  it('guarda comuna y lat/lng cuando vienen juntos', () => {
    const parsed = tripRequestCreateInputSchema.parse(
      base({
        origin: { comuna_code: '13101', latitude: -33.4391, longitude: -70.6488 },
        destination: { comuna_code: '08101', latitude: -36.827, longitude: -73.0503 },
      }),
    );
    expect(parsed.origin.comuna_code).toBe('13101');
    expect(parsed.origin.latitude).toBe(-33.4391);
    expect(parsed.destination.longitude).toBe(-73.0503);
  });

  it('la región vacía dice Selecciona una región, no el enum en inglés', () => {
    const result = tripRequestCreateInputSchema.safeParse(
      base({ destination: { region_code: '' } }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      const region = result.error.issues.find((issue) =>
        issue.path.join('.').startsWith('destination.region_code'),
      );
      expect(region?.message).toBe('Selecciona una región');
    }
  });

  it('rechaza latitud sin longitud y el punto 0,0', () => {
    expect(
      tripRequestCreateInputSchema.safeParse(base({ origin: { latitude: -33.4 } })).success,
    ).toBe(false);
    expect(
      tripRequestCreateInputSchema.safeParse(base({ origin: { latitude: 0, longitude: -70.6 } }))
        .success,
    ).toBe(false);
  });

  it('rechaza una comuna que no pertenece a la región', () => {
    const result = tripRequestCreateInputSchema.safeParse(
      base({ origin: { comuna_code: '08101' } }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      const comuna = result.error.issues.find(
        (issue) => issue.path.join('.') === 'origin.comuna_code',
      );
      expect(comuna?.message).toBe('La comuna no pertenece a la región');
    }
  });

  it('rechaza un punto fuera de Chile y acepta Pascua y Magallanes', () => {
    const madrid = tripRequestCreateInputSchema.safeParse(
      base({ origin: { latitude: 40.42, longitude: -3.7 } }),
    );
    expect(madrid.success).toBe(false);
    if (!madrid.success) {
      expect(
        madrid.error.issues.some((issue) => issue.message === 'El punto tiene que estar en Chile'),
      ).toBe(true);
    }
    expect(
      tripRequestCreateInputSchema.safeParse(
        base({
          origin: {
            region_code: 'V',
            latitude: -27.1127,
            longitude: -109.3497,
            comuna_code: '05201',
          },
        }),
      ).success,
    ).toBe(true);
    expect(
      tripRequestCreateInputSchema.safeParse(
        base({
          destination: {
            region_code: 'XII',
            latitude: -53.1638,
            longitude: -70.9171,
            comuna_code: '12101',
          },
        }),
      ).success,
    ).toBe(true);
  });
});
