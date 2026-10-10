import { describe, expect, it, vi } from 'vitest';
import { leerViajesEntregados } from './viajes-entregados.js';

/** La consulta real se prueba contra Postgres (observatorio-viajes.integration.test.ts). */
describe('leerViajesEntregados', () => {
  it('descarta filas sin entrega (defensa del tipo de Drizzle)', async () => {
    const entregado = new Date('2026-10-07T16:00:00Z');
    const filas = [
      { viajeId: 'a', entregadoEn: entregado },
      { viajeId: 'b', entregadoEn: null },
    ];
    const chain: Record<string, unknown> = {};
    for (const m of ['from', 'innerJoin', 'leftJoin', 'where']) {
      chain[m] = vi.fn(() => chain);
    }
    chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(filas).then(resolve);
    const db = { select: vi.fn(() => chain) };
    const r = await leerViajesEntregados(db as never);
    expect(r).toEqual([{ viajeId: 'a', entregadoEn: entregado }]);
  });
});
