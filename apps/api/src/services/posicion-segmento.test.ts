import { getTableName } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../db/client.js';
import { fuentePosicionSegmento, resolverPosicionesSegmento } from './posicion-segmento.js';

/**
 * Task 10 (plan medicion-huella-segmento, ADR-077 §1): enrutamiento de la
 * fuente de posición por tipo de vehículo, SIN merge de streams.
 *   - `teltonika_imei` propio → `telemetria_puntos` por `vehiculo_id`
 *   - solo `teltonika_imei_espejo` → `telemetria_puntos` por `imei`
 *   - sin dispositivo → `posiciones_movil_conductor` por `vehiculo_id`
 * La semántica contra Postgres real (ventana, orden, una sola fuente) la
 * prueba `test/integration/posicion-segmento.integration.test.ts`; acá el
 * clasificador puro y la proyección/filtro de coordenadas.
 */

const DESDE = new Date('2026-08-10T10:00:00Z');
const HASTA = new Date('2026-08-10T12:00:00Z');

/**
 * DB stub: cada `.select().from(tabla)` registra el nombre de la tabla y
 * resuelve con las filas dadas. La cadena es awaitable tras `.orderBy()` (igual
 * que Drizzle) y también vía `.limit()` por si algún path lo usa.
 */
function makeDb(rows: Array<{ ts: Date; lat: string | null; lng: string | null }>) {
  const tablas: string[] = [];
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn((tabla: unknown) => {
    tablas.push(getTableName(tabla as never));
    return chain;
  });
  chain.where = vi.fn(() => chain);
  chain.orderBy = vi.fn(() => Promise.resolve(rows));
  chain.limit = vi.fn(() => Promise.resolve(rows));
  const select = vi.fn(() => chain);
  return { db: { select } as unknown as Db, tablas, select };
}

const CON_IMEI = { id: 'veh-a', teltonikaImei: '860000000000001', teltonikaImeiEspejo: null };
const CON_ESPEJO = { id: 'veh-b', teltonikaImei: null, teltonikaImeiEspejo: '860000000000001' };
const CON_AMBOS = {
  id: 'veh-ab',
  teltonikaImei: '860000000000002',
  teltonikaImeiEspejo: '860000000000001',
};
const SIN_DEVICE = { id: 'veh-c', teltonikaImei: null, teltonikaImeiEspejo: null };

describe('fuentePosicionSegmento (puro)', () => {
  it('imei propio → teltonika_gps por vehicle_id (aunque también tenga espejo)', () => {
    expect(fuentePosicionSegmento(CON_IMEI)).toEqual({
      fuente: 'teltonika_gps',
      via: 'vehicle_id',
    });
    expect(fuentePosicionSegmento(CON_AMBOS)).toEqual({
      fuente: 'teltonika_gps',
      via: 'vehicle_id',
    });
  });

  it('solo espejo → teltonika_gps por imei (el stream es de otro vehículo físico)', () => {
    expect(fuentePosicionSegmento(CON_ESPEJO)).toEqual({
      fuente: 'teltonika_gps',
      via: 'imei',
      imei: '860000000000001',
    });
  });

  it('sin dispositivo → movil_gps (posiciones del móvil del conductor)', () => {
    expect(fuentePosicionSegmento(SIN_DEVICE)).toEqual({ fuente: 'movil_gps' });
  });
});

describe('resolverPosicionesSegmento', () => {
  it('con imei propio consulta SOLO telemetria_puntos y proyecta ts/lat/lng a PingPoint', async () => {
    const { db, tablas } = makeDb([
      { ts: new Date('2026-08-10T10:05:00Z'), lat: '-33.4500000', lng: '-70.6600000' },
      { ts: new Date('2026-08-10T10:06:00Z'), lat: '-33.4510000', lng: '-70.6610000' },
    ]);

    const pings = await resolverPosicionesSegmento({
      db,
      vehicle: CON_IMEI,
      desde: DESDE,
      hasta: HASTA,
    });

    expect(tablas).toEqual(['telemetria_puntos']);
    expect(pings).toEqual([
      { tMs: Date.parse('2026-08-10T10:05:00Z'), lat: -33.45, lng: -70.66 },
      { tMs: Date.parse('2026-08-10T10:06:00Z'), lat: -33.451, lng: -70.661 },
    ]);
  });

  it('con solo espejo consulta SOLO telemetria_puntos (por imei)', async () => {
    const { db, tablas } = makeDb([
      { ts: new Date('2026-08-10T10:05:00Z'), lat: '-33.4500000', lng: '-70.6600000' },
    ]);

    const pings = await resolverPosicionesSegmento({
      db,
      vehicle: CON_ESPEJO,
      desde: DESDE,
      hasta: HASTA,
    });

    expect(tablas).toEqual(['telemetria_puntos']);
    expect(pings).toHaveLength(1);
  });

  it('sin dispositivo consulta SOLO posiciones_movil_conductor (fallback sin FMC150)', async () => {
    const { db, tablas } = makeDb([
      { ts: new Date('2026-08-10T10:05:00Z'), lat: '-33.4500000', lng: '-70.6600000' },
    ]);

    const pings = await resolverPosicionesSegmento({
      db,
      vehicle: SIN_DEVICE,
      desde: DESDE,
      hasta: HASTA,
    });

    expect(tablas).toEqual(['posiciones_movil_conductor']);
    expect(pings).toEqual([{ tMs: Date.parse('2026-08-10T10:05:00Z'), lat: -33.45, lng: -70.66 }]);
  });

  it('descarta filas sin fix: lat/lng null y el null island (0,0), en cualquier fuente', async () => {
    const { db } = makeDb([
      { ts: new Date('2026-08-10T10:05:00Z'), lat: null, lng: null },
      { ts: new Date('2026-08-10T10:06:00Z'), lat: '0.0000000', lng: '0.0000000' },
      { ts: new Date('2026-08-10T10:07:00Z'), lat: '-33.4500000', lng: '-70.6600000' },
    ]);

    const pings = await resolverPosicionesSegmento({
      db,
      vehicle: CON_IMEI,
      desde: DESDE,
      hasta: HASTA,
    });

    expect(pings).toEqual([{ tMs: Date.parse('2026-08-10T10:07:00Z'), lat: -33.45, lng: -70.66 }]);
  });

  it('sin filas en la ventana → [] (no lanza; la cobertura decide la degradación)', async () => {
    const { db } = makeDb([]);
    await expect(
      resolverPosicionesSegmento({ db, vehicle: SIN_DEVICE, desde: DESDE, hasta: HASTA }),
    ).resolves.toEqual([]);
  });
});
