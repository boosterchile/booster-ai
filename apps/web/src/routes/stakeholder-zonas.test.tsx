import { describe, expect, it } from 'vitest';
import type { ZonaCard } from '../services/stakeholder-aggregations-client.js';

/**
 * D11/T11 — tests cualitativos de UI ahora usan integration con TanStack
 * Query mock (jsdom). Aquí dejamos un smoke type-level + assertion sobre
 * el shape ZonaCard que el componente espera consumir.
 */
describe('ZonaCard contract (T11)', () => {
  it('insufficient_data:true acepta valores null en métricos', () => {
    const z: ZonaCard = {
      id: 'z-1',
      slug: 'puerto-valparaiso',
      nombre: 'Puerto Valparaíso',
      region: 'CL-VS',
      tipo: 'puerto',
      viajes_30d: null,
      co2e_total_kg: null,
      horario_pico_inicio: null,
      horario_pico_fin: null,
      insufficient_data: true,
    };
    expect(z.insufficient_data).toBe(true);
    expect(z.viajes_30d).toBeNull();
  });

  it('insufficient_data:false acepta números', () => {
    const z: ZonaCard = {
      id: 'z-2',
      slug: 'puerto-san-antonio',
      nombre: 'Puerto San Antonio',
      region: 'CL-VS',
      tipo: 'puerto',
      viajes_30d: 50,
      co2e_total_kg: 1200,
      horario_pico_inicio: 5,
      horario_pico_fin: 8,
      insufficient_data: false,
    };
    expect(z.viajes_30d).toBe(50);
    expect(z.horario_pico_inicio).toBe(5);
  });
});
