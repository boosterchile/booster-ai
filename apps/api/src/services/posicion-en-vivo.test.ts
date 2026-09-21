import { getTableName } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../db/client.js';
import { resolverPosicionEnVivo } from './posicion-en-vivo.js';

/**
 * Spec `.specs/tracking-live-unificado/` §2 — regla de fuente para la ÚLTIMA
 * posición viva (no la huella: eso es `posicion-segmento.ts` / ADR-077):
 *   1. estado fuera de asignado|en_proceso → nada, sin tocar la BD;
 *   2. Teltonika fresco → `teltonika` (el móvil ni se consulta);
 *   3. si no, móvil fresco de ESTA asignación → `mobile`;
 *   4. ninguno → `source: null`, `pings: []`.
 * La semántica SQL (ventana 30 min, filtro por asignación, null island) la
 * prueba `test/integration/posicion-en-vivo.integration.test.ts`.
 */

const NOW = Date.parse('2026-09-20T15:00:00Z');
const hace = (min: number) => new Date(NOW - min * 60_000);

/**
 * DB stub: cada `.select().from(tabla)` registra la tabla y resuelve, vía
 * `.limit()`, las filas configuradas para ESA tabla.
 */
/** Primera columna Drizzle dentro de un `desc(...)`: tiene `name` y `table`. */
function columnaOrden(arg: unknown): string | null {
  const vistos = new Set<unknown>();
  const buscar = (v: unknown): string | null => {
    if (v == null || typeof v !== 'object' || vistos.has(v)) {
      return null;
    }
    vistos.add(v);
    const o = v as Record<string, unknown>;
    if (typeof o.name === 'string' && 'table' in o) {
      return o.name;
    }
    for (const hijo of Array.isArray(v) ? v : Object.values(o)) {
      const hallada = buscar(hijo);
      if (hallada) {
        return hallada;
      }
    }
    return null;
  };
  return buscar(arg);
}

function makeDb(filas: { telemetria?: unknown[]; movil?: unknown[] }) {
  const tablas: string[] = [];
  const ordenes: string[][] = [];
  const select = vi.fn(() => {
    let tabla = '';
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn((t: unknown) => {
      tabla = getTableName(t as never);
      tablas.push(tabla);
      return chain;
    });
    chain.where = vi.fn(() => chain);
    chain.orderBy = vi.fn((...args: unknown[]) => {
      ordenes.push(args.map(columnaOrden).filter((n): n is string => n != null));
      return chain;
    });
    chain.limit = vi.fn(() =>
      Promise.resolve(
        tabla === 'telemetria_puntos' ? (filas.telemetria ?? []) : (filas.movil ?? []),
      ),
    );
    return chain;
  });
  return { db: { select } as unknown as Db, tablas, ordenes, select };
}

const BASE = { assignmentId: 'asg-1', vehicleId: 'veh-1', nowMs: NOW };

describe('resolverPosicionEnVivo', () => {
  it('solo GPS del móvil fresco → source mobile, numeric→number, DESC preservado', async () => {
    const { db, tablas, ordenes } = makeDb({
      telemetria: [],
      movil: [
        {
          timestamp: hace(1),
          latitude: '-33.4172000',
          longitude: '-70.6063000',
          speedKmh: '42.50',
          angleDeg: 180,
        },
        {
          timestamp: hace(3),
          latitude: '-33.4200000',
          longitude: '-70.6100000',
          speedKmh: null,
          angleDeg: null,
        },
      ],
    });

    const r = await resolverPosicionEnVivo({ db, ...BASE, tripStatus: 'en_proceso' });

    expect(tablas).toEqual(['telemetria_puntos', 'posiciones_movil_conductor']);
    expect(ordenes[0]).toEqual(['timestamp_device', 'id']);
    expect(ordenes[1]).toEqual(['timestamp_device', 'id']);
    expect(r.source).toBe('mobile');
    expect(r.pings).toEqual([
      {
        timestamp: hace(1),
        latitude: -33.4172,
        longitude: -70.6063,
        speedKmh: 42.5,
        angleDeg: 180,
      },
      { timestamp: hace(3), latitude: -33.42, longitude: -70.61, speedKmh: null, angleDeg: null },
    ]);
  });

  it('Teltonika fresco → source teltonika y el móvil NI se consulta (sin merge de streams)', async () => {
    const { db, tablas } = makeDb({
      telemetria: [
        {
          timestamp: hace(2),
          latitude: '-33.4500000',
          longitude: '-70.6600000',
          speedKmh: 65,
          angleDeg: 90,
        },
      ],
      movil: [
        {
          timestamp: hace(0),
          latitude: '-33.0000000',
          longitude: '-70.0000000',
          speedKmh: '10.00',
          angleDeg: 1,
        },
      ],
    });

    const r = await resolverPosicionEnVivo({ db, ...BASE, tripStatus: 'asignado' });

    expect(tablas).toEqual(['telemetria_puntos']);
    expect(r.source).toBe('teltonika');
    expect(r.pings).toEqual([
      { timestamp: hace(2), latitude: -33.45, longitude: -70.66, speedKmh: 65, angleDeg: 90 },
    ]);
  });

  it('ninguna fuente fresca → source null, pings []', async () => {
    const { db, tablas } = makeDb({ telemetria: [], movil: [] });

    const r = await resolverPosicionEnVivo({ db, ...BASE, tripStatus: 'en_proceso' });

    expect(tablas).toEqual(['telemetria_puntos', 'posiciones_movil_conductor']);
    expect(r).toEqual({ source: null, pings: [] });
  });

  it.each(['entregado', 'cancelado', 'expirado', 'esperando_match', 'estado_futuro'])(
    'estado %s (fuera del allowlist) → nada y CERO consultas (fail-closed)',
    async (tripStatus) => {
      const { db, select } = makeDb({
        telemetria: [
          {
            timestamp: hace(1),
            latitude: '-33.45',
            longitude: '-70.66',
            speedKmh: 50,
            angleDeg: 0,
          },
        ],
      });

      const r = await resolverPosicionEnVivo({ db, ...BASE, tripStatus });

      expect(r).toEqual({ source: null, pings: [] });
      expect(select).not.toHaveBeenCalled();
    },
  );

  it('descarta filas sin fix que se cuelen (null island / no numéricas) en ambas fuentes', async () => {
    const { db } = makeDb({
      telemetria: [
        { timestamp: hace(1), latitude: '0', longitude: '0', speedKmh: 0, angleDeg: 0 },
        { timestamp: hace(2), latitude: null, longitude: '-70.66', speedKmh: 0, angleDeg: 0 },
      ],
      movil: [
        {
          timestamp: hace(1),
          latitude: '0.0000000',
          longitude: '-70.6',
          speedKmh: null,
          angleDeg: null,
        },
        {
          timestamp: hace(2),
          latitude: '-33.4',
          longitude: '-70.6',
          speedKmh: null,
          angleDeg: null,
        },
      ],
    });

    const r = await resolverPosicionEnVivo({ db, ...BASE, tripStatus: 'en_proceso' });

    // Teltonika sin ningún fix válido NO cuenta como «fresco» → cae al móvil.
    expect(r.source).toBe('mobile');
    expect(r.pings).toEqual([
      { timestamp: hace(2), latitude: -33.4, longitude: -70.6, speedKmh: null, angleDeg: null },
    ]);
  });
});
