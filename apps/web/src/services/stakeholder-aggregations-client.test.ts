import { describe, expect, it } from 'vitest';
import type {
  AgregacionesZona,
  BucketCombustible,
  BucketHora,
  BucketTipoCarga,
} from './stakeholder-aggregations-client.js';

/**
 * Smoke test del shape — los hooks de TanStack Query se testean por las
 * páginas que los consumen (integration test cualitativo via vitest +
 * jsdom queda como follow-up; aquí solo verificamos el contrato del tipo).
 */
describe('stakeholder-aggregations-client types', () => {
  it('AgregacionesZona acepta forma esperada con k-anonymity nullables', () => {
    const r: AgregacionesZona = {
      por_hora_del_dia: [
        { hora: 0, viajes: null, co2e_kg: null },
        { hora: 8, viajes: 10, co2e_kg: 250 },
      ] as BucketHora[],
      por_tipo_carga: [{ tipo: 'carga_seca', viajes: 5, co2e_kg: 100 }] as BucketTipoCarga[],
      por_combustible: [{ fuel_type: 'diesel', viajes: 6, co2e_kg: 120 }] as BucketCombustible[],
      metodologia: {
        k_anonymity: 5,
        ventana_dias: 30,
        fuente: 'viajes_completados',
        generado_at: new Date().toISOString(),
      },
    };
    expect(r.metodologia.k_anonymity).toBe(5);
    expect(r.por_hora_del_dia[0]?.viajes).toBeNull();
    expect(r.por_hora_del_dia[1]?.viajes).toBe(10);
  });
});
