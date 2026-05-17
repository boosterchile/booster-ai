import { describe, expect, it } from 'vitest';
import { aplicarKAnonymity } from './k-anonymity.js';

describe('aplicarKAnonymity — modo mask (default)', () => {
  it('preserva bucket cuando count >= k (k=5, count=10)', () => {
    const buckets = [{ hora: 9, viajes: 10, co2e_kg: 250.5 }];
    const result = aplicarKAnonymity(buckets, 5, 'viajes', { preserveFields: ['hora'] });
    expect(result).toEqual([{ hora: 9, viajes: 10, co2e_kg: 250.5 }]);
  });

  it('enmascara métricos cuando count < k, preserva dimensión hora', () => {
    const buckets = [{ hora: 9, viajes: 4, co2e_kg: 90.2 }];
    const result = aplicarKAnonymity(buckets, 5, 'viajes', { preserveFields: ['hora'] });
    expect(result).toEqual([{ hora: 9, viajes: null, co2e_kg: null }]);
  });

  it('caso borde count exactamente k → preservado', () => {
    const buckets = [{ tipo: 'general', viajes: 5, co2e_kg: 120 }];
    const result = aplicarKAnonymity(buckets, 5, 'viajes');
    expect(result).toEqual([{ tipo: 'general', viajes: 5, co2e_kg: 120 }]);
  });

  it('caso borde count k-1 → enmascarado (incluido el string tipo)', () => {
    const buckets = [{ fuel_type: 'diesel', viajes: 4, co2e_kg: 80 }];
    const result = aplicarKAnonymity(buckets, 5, 'viajes');
    expect(result).toEqual([{ fuel_type: null, viajes: null, co2e_kg: null }]);
  });

  it('array vacío retorna array vacío', () => {
    expect(aplicarKAnonymity([], 5, 'viajes')).toEqual([]);
  });

  it('mix: invariante por bucket — algunos preservados, otros enmascarados', () => {
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

describe('aplicarKAnonymity — SECURITY: quasi-identifier strings', () => {
  it('enmascara strings (quasi-identifiers) cuando count < k', () => {
    const buckets = [{ slug: 'puerto-x', viajes: 3, co2e_kg: 50 }];
    const result = aplicarKAnonymity(buckets, 5, 'viajes');
    expect(result).toEqual([{ slug: null, viajes: null, co2e_kg: null }]);
  });

  it('enmascara booleans cuando count < k', () => {
    const buckets = [{ es_activo: true, viajes: 3, co2e_kg: 50 }];
    const result = aplicarKAnonymity(buckets, 5, 'viajes');
    expect(result).toEqual([{ es_activo: null, viajes: null, co2e_kg: null }]);
  });

  it('preserveFields permite mantener un string explícito (e.g. dimensión segura)', () => {
    const buckets = [{ dia_semana: 'lunes', viajes: 3, co2e_kg: 50 }];
    const result = aplicarKAnonymity(buckets, 5, 'viajes', {
      preserveFields: ['dia_semana'],
    });
    expect(result).toEqual([{ dia_semana: 'lunes', viajes: null, co2e_kg: null }]);
  });
});

describe('aplicarKAnonymity — SECURITY: k validation', () => {
  it('throw si k = 0', () => {
    expect(() => aplicarKAnonymity([], 0, 'viajes')).toThrow(/k debe ser entero >= 2/);
  });

  it('throw si k = 1', () => {
    expect(() => aplicarKAnonymity([], 1, 'viajes')).toThrow(/k debe ser entero >= 2/);
  });

  it('throw si k es negativo', () => {
    expect(() => aplicarKAnonymity([], -5, 'viajes')).toThrow(/k debe ser entero >= 2/);
  });

  it('throw si k no es entero (e.g. 2.5)', () => {
    expect(() => aplicarKAnonymity([], 2.5, 'viajes')).toThrow(/k debe ser entero >= 2/);
  });

  it('acepta k = 2 (mínimo)', () => {
    const buckets = [{ viajes: 3 }];
    expect(() => aplicarKAnonymity(buckets, 2, 'viajes')).not.toThrow();
  });
});

describe('aplicarKAnonymity — SECURITY: fail-closed con countField no-numérico', () => {
  it('NaN en countField → enmascarado (fail-closed)', () => {
    const buckets = [{ hora: 9, viajes: Number.NaN, co2e_kg: 50 }];
    const result = aplicarKAnonymity(buckets, 5, 'viajes', { preserveFields: ['hora'] });
    expect(result).toEqual([{ hora: 9, viajes: null, co2e_kg: null }]);
  });

  it('Infinity en countField → enmascarado (fail-closed; no se asume >= k)', () => {
    const buckets = [{ hora: 9, viajes: Number.POSITIVE_INFINITY, co2e_kg: 50 }];
    const result = aplicarKAnonymity(buckets, 5, 'viajes', { preserveFields: ['hora'] });
    expect(result).toEqual([{ hora: 9, viajes: null, co2e_kg: null }]);
  });

  it('countField undefined → enmascarado (fail-closed)', () => {
    const buckets = [
      { hora: 9, co2e_kg: 50 } as unknown as { hora: number; viajes: number; co2e_kg: number },
    ];
    const result = aplicarKAnonymity(buckets, 5, 'viajes', { preserveFields: ['hora'] });
    expect(result).toEqual([{ hora: 9, co2e_kg: null }]);
  });

  it('countField string ("10") → enmascarado (no se hace cast implícito)', () => {
    const buckets = [{ hora: 9, viajes: '10' as unknown as number, co2e_kg: 50 }];
    const result = aplicarKAnonymity(buckets, 5, 'viajes', { preserveFields: ['hora'] });
    expect(result).toEqual([{ hora: 9, viajes: null, co2e_kg: null }]);
  });
});

describe('aplicarKAnonymity — modo dropSubKBuckets', () => {
  it('filtra buckets con count < k del output', () => {
    const buckets = [
      { hora: 8, viajes: 10 },
      { hora: 9, viajes: 3 },
      { hora: 10, viajes: 7 },
    ];
    const result = aplicarKAnonymity(buckets, 5, 'viajes', {
      dropSubKBuckets: true,
    });
    expect(result).toEqual([
      { hora: 8, viajes: 10 },
      { hora: 10, viajes: 7 },
    ]);
  });

  it('filtra también buckets con NaN/Infinity/undefined countField', () => {
    const buckets = [
      { tipo: 'a', viajes: 10 },
      { tipo: 'b', viajes: Number.NaN },
      { tipo: 'c', viajes: Number.POSITIVE_INFINITY },
    ];
    const result = aplicarKAnonymity(buckets, 5, 'viajes', {
      dropSubKBuckets: true,
    });
    expect(result).toEqual([{ tipo: 'a', viajes: 10 }]);
  });

  it('use case D11 por_tipo_carga: zona con 7 viajes (5 carga_seca + 2 gnv) → solo carga_seca aparece', () => {
    const buckets = [
      { tipo: 'carga_seca', viajes: 5, co2e_kg: 100 },
      { tipo: 'gnv', viajes: 2, co2e_kg: 40 },
    ];
    const result = aplicarKAnonymity(buckets, 5, 'viajes', {
      dropSubKBuckets: true,
    });
    expect(result).toEqual([{ tipo: 'carga_seca', viajes: 5, co2e_kg: 100 }]);
    // El bucket gnv NO aparece → no se leak su existencia → privacy preservada.
  });

  it('array vacío con dropSubKBuckets → vacío', () => {
    expect(aplicarKAnonymity([], 5, 'viajes', { dropSubKBuckets: true })).toEqual([]);
  });

  it('todos los buckets >= k → output igual al input', () => {
    const buckets = [
      { tipo: 'a', viajes: 10 },
      { tipo: 'b', viajes: 5 },
    ];
    const result = aplicarKAnonymity(buckets, 5, 'viajes', {
      dropSubKBuckets: true,
    });
    expect(result).toEqual(buckets);
  });
});
