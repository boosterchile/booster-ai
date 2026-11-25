import { describe, expect, it } from 'vitest';
import { aplicarKAnonymity } from './k-anonymity.js';
import { UMBRAL_ANONIMATO } from './umbral-anonimato.js';

describe('UMBRAL_ANONIMATO (ADR-096)', () => {
  it('es 1: un dato agregado se muestra desde un camión o un viaje', () => {
    expect(UMBRAL_ANONIMATO).toBe(1);
  });

  it('con el umbral, un grupo de 1 se publica y un grupo vacío no', () => {
    const grupos = [
      { tipo: 'carga_seca', viajes: 1, co2e_kg: 30 },
      { tipo: 'perecible', viajes: 0, co2e_kg: 0 },
    ];
    expect(
      aplicarKAnonymity(grupos, UMBRAL_ANONIMATO, 'viajes', { dropSubKBuckets: true }),
    ).toEqual([{ tipo: 'carga_seca', viajes: 1, co2e_kg: 30 }]);
  });
});
