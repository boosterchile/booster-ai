import { describe, expect, it } from 'vitest';
import { aplicarKAnonymity } from './k-anonymity.js';

describe('aplicarKAnonymity', () => {
  it('preserva bucket cuando count >= k (k=5, count=10)', () => {
    const buckets = [{ hora: 9, viajes: 10, co2e_kg: 250.5 }];
    const result = aplicarKAnonymity(buckets, 5, 'viajes', { preserveFields: ['hora'] });
    expect(result).toEqual([{ hora: 9, viajes: 10, co2e_kg: 250.5 }]);
  });

  it('reemplaza métricos por null cuando count < k, preserva dimensión hora', () => {
    const buckets = [{ hora: 9, viajes: 4, co2e_kg: 90.2 }];
    const result = aplicarKAnonymity(buckets, 5, 'viajes', { preserveFields: ['hora'] });
    expect(result).toEqual([{ hora: 9, viajes: null, co2e_kg: null }]);
  });

  it('caso borde count exactamente k → preservado', () => {
    const buckets = [{ tipo: 'general', viajes: 5, co2e_kg: 120 }];
    const result = aplicarKAnonymity(buckets, 5, 'viajes');
    expect(result).toEqual([{ tipo: 'general', viajes: 5, co2e_kg: 120 }]);
  });

  it('caso borde count k-1 → nulled', () => {
    const buckets = [{ fuel_type: 'diesel', viajes: 4, co2e_kg: 80 }];
    const result = aplicarKAnonymity(buckets, 5, 'viajes');
    expect(result).toEqual([{ fuel_type: 'diesel', viajes: null, co2e_kg: null }]);
  });

  it('k=1 → viajes=0 se nullea', () => {
    const buckets = [{ hora: 3, viajes: 0, co2e_kg: 0 }];
    const result = aplicarKAnonymity(buckets, 1, 'viajes', { preserveFields: ['hora'] });
    expect(result).toEqual([{ hora: 3, viajes: null, co2e_kg: null }]);
  });

  it('k=0 → ningún bucket se nullea (todos count >= 0)', () => {
    const buckets = [{ hora: 0, viajes: 0, co2e_kg: 0 }];
    const result = aplicarKAnonymity(buckets, 0, 'viajes', { preserveFields: ['hora'] });
    expect(result).toEqual([{ hora: 0, viajes: 0, co2e_kg: 0 }]);
  });

  it('array vacío retorna array vacío', () => {
    expect(aplicarKAnonymity([], 5, 'viajes')).toEqual([]);
  });

  it('preserva no-numéricos (string, boolean, null) en buckets nulled', () => {
    const buckets = [
      { slug: 'puerto-x', viajes: 3, co2e_kg: 50, es_activo: true, comentario: null },
    ];
    const result = aplicarKAnonymity(buckets, 5, 'viajes');
    expect(result).toEqual([
      { slug: 'puerto-x', viajes: null, co2e_kg: null, es_activo: true, comentario: null },
    ]);
  });

  it('mix: invariante por bucket — algunos preservados, otros nulled', () => {
    const buckets = [
      { hora: 8, viajes: 10, co2e_kg: 200 },
      { hora: 9, viajes: 3, co2e_kg: 60 },
      { hora: 10, viajes: 7, co2e_kg: 140 },
    ];
    const result = aplicarKAnonymity(buckets, 5, 'viajes', { preserveFields: ['hora'] });
    expect(result[0]).toEqual({ hora: 8, viajes: 10, co2e_kg: 200 });
    expect(result[1]).toEqual({ hora: 9, viajes: null, co2e_kg: null });
    expect(result[2]).toEqual({ hora: 10, viajes: 7, co2e_kg: 140 });
  });

  it('no muta el input array ni sus buckets', () => {
    const original = [{ hora: 9, viajes: 4, co2e_kg: 90 }];
    const snapshot = JSON.parse(JSON.stringify(original));
    aplicarKAnonymity(original, 5, 'viajes', { preserveFields: ['hora'] });
    expect(original).toEqual(snapshot);
  });
});
