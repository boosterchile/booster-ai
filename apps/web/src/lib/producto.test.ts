import { describe, expect, it } from 'vitest';
import type { MeResponse } from '../hooks/use-me.js';
import { NOMBRE_PRODUCTO, productoDe } from './producto.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;

function me(empresa: Record<string, unknown> | null): MeOnboarded {
  return {
    needs_onboarding: false,
    active_membership: empresa === null ? null : { role: 'dueno', empresa },
  } as unknown as MeOnboarded;
}

describe('productoDe (booster-fleet-interfaz §4.1)', () => {
  it('fleet: transportista, no generadora, sin ofertas de carga', () => {
    expect(
      productoDe(
        me({ is_transportista: true, is_generador_carga: false, recibe_ofertas_carga: false }),
      ),
    ).toBe('fleet');
  });

  it.each([
    ['con ofertas de carga', { is_transportista: true, recibe_ofertas_carga: true }],
    ['sin el dato en /me', { is_transportista: true, is_generador_carga: false }],
    [
      'también generadora',
      { is_transportista: true, is_generador_carga: true, recibe_ofertas_carga: false },
    ],
    ['solo generadora', { is_transportista: false, is_generador_carga: true }],
    ['sin empresa', null],
  ])('booster: %s', (_caso, empresa) => {
    expect(productoDe(me(empresa))).toBe('booster');
  });

  it('cada producto tiene su nombre de marca', () => {
    expect(NOMBRE_PRODUCTO).toEqual({ booster: 'Booster AI', fleet: 'Booster Fleet' });
  });
});
