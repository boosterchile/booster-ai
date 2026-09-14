import { describe, expect, it } from 'vitest';
import { routeDataSourceSchema } from './trip-metrics.js';

/**
 * ADR-077 §1 — la posición del móvil del conductor es fuente de ruta de
 * PRIMERA CLASE: `movil_gps`, distinta de `teltonika_gps` (mentiría sobre el
 * sensor) y de `maps_directions` (ocultaría que la distancia fue medida).
 * Este schema es el contrato canónico del dominio; la migración 0055 y el
 * `routeDataSourceEnum` de Drizzle son sus espejos.
 */
describe('routeDataSourceSchema — movil_gps como fuente de primera clase (ADR-077 §1)', () => {
  it('acepta movil_gps', () => {
    expect(routeDataSourceSchema.safeParse('movil_gps').success).toBe(true);
  });

  it('conserva las tres fuentes de ADR-028 §1 (contrato de datos ya escrito en filas)', () => {
    for (const fuente of ['teltonika_gps', 'maps_directions', 'manual_declared']) {
      expect(routeDataSourceSchema.safeParse(fuente).success, fuente).toBe(true);
    }
  });

  it('rechaza un valor desconocido', () => {
    expect(routeDataSourceSchema.safeParse('phone_gps').success).toBe(false);
  });

  it('espejo exacto del enum de BD: cuatro valores en el orden de las migraciones 0009 + 0055', () => {
    expect(routeDataSourceSchema.options).toEqual([
      'teltonika_gps',
      'maps_directions',
      'manual_declared',
      'movil_gps',
    ]);
  });
});
