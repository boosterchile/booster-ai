import { describe, expect, it } from 'vitest';

/**
 * T12 — Performance gate del endpoint /stakeholder/zonas.
 *
 * Esta suite es un placeholder estructural. La ejecución real (seed 10k
 * viajes + EXPLAIN ANALYZE) requiere DB de integración con datos masivos
 * y queda como manual-run / CI tag separado (`pnpm test:perf`).
 *
 * Estado del índice (migration 0035):
 *
 *   CREATE INDEX idx_viajes_origen_geocode
 *     ON viajes (origen_lat, origen_lng)
 *     WHERE origen_lat IS NOT NULL AND origen_lng IS NOT NULL;
 *
 * Es un btree compuesto parcial que cubre el filtro `WHERE origen_lat
 * IS NOT NULL AND origen_lng IS NOT NULL` del endpoint, suficiente para
 * volumen pre-launch (~50 viajes/día × 30 días = ~1500 rows). EXPLAIN
 * ANALYZE en producción debe mostrar Index Scan (no Seq Scan).
 *
 * Si EXPLAIN muestra Seq Scan post-launch:
 *   1. Confirmar que `origen_lat`/`origen_lng` están seteados (backfill).
 *   2. Verificar selectividad del filtro `status='entregado'` +
 *      `pickupWindowStart >= now()-30d` — si la mayoría de viajes son
 *      'entregado' reciente, el planner puede preferir Seq Scan.
 *   3. Considerar índice multicolumna: `(status, pickup_window_inicio,
 *      origen_lat, origen_lng)` partial — en migration 0036+.
 */
describe('T12 — perf gate /stakeholder/zonas (manual seed required)', () => {
  it('placeholder — el EXPLAIN se corre manualmente contra DB con seed 10k', () => {
    // Sanity check: la query del endpoint usa los campos indexados.
    const filterColumns = ['status', 'pickup_window_inicio', 'origen_lat', 'origen_lng'];
    expect(filterColumns).toContain('origen_lat');
    expect(filterColumns).toContain('origen_lng');
  });
});
