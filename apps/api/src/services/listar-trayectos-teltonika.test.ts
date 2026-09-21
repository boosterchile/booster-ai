import type { Logger } from '@booster-ai/logger';
import { describe, expect, it, vi } from 'vitest';
import { listarTrayectosTeltonika } from './listar-trayectos-teltonika.js';

const EMPRESA = '22222222-2222-4222-8222-222222222222';
const VEHICULO = '11111111-1111-4111-8111-111111111111';

const noop = (): void => undefined;
const logger = {
  trace: noop,
  debug: noop,
  info: noop,
  warn: vi.fn(),
  error: noop,
  fatal: noop,
  child: () => logger,
} as never as Logger;

function cadena(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.from = vi.fn(self);
  chain.where = vi.fn(self);
  chain.orderBy = vi.fn(self);
  chain.limit = vi.fn(async () => rows);
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(rows).then(resolve, reject);
  return chain;
}

function makeDb(vehiculos: unknown[], puntos: unknown[]) {
  let llamadas = 0;
  return {
    llamadas: () => llamadas,
    db: {
      select: vi.fn(() => {
        llamadas += 1;
        return cadena(llamadas === 1 ? vehiculos : puntos);
      }),
    } as never,
  };
}

const desde = new Date('2026-09-01T00:00:00.000Z');
const hasta = new Date('2026-09-08T00:00:00.000Z');

describe('listarTrayectosTeltonika', () => {
  it('sin vehículos Teltonika devuelve vacío y CTA, sin leer puntos', async () => {
    const db = makeDb([], []);
    const lista = await listarTrayectosTeltonika({
      db: db.db,
      logger,
      empresaId: EMPRESA,
      desde,
      hasta,
      page: 1,
      pageSize: 20,
    });
    expect(lista.cta).toBe('vincular_teltonika');
    expect(lista.trayectos).toEqual([]);
    expect(lista.vehiculosTeltonika).toBe(0);
    expect(db.llamadas()).toBe(1);
  });

  it('pagina los trayectos más recientes y marca truncado si el tope se pasa', async () => {
    const t0 = Date.parse('2026-09-02T12:00:00.000Z');
    const puntos = [0, 1, 2, 3].map((i) => ({
      vehicleId: VEHICULO,
      timestampDevice: new Date(t0 + i * 60_000),
      latitude: String(-33.45 - i * 0.01),
      longitude: '-70.66',
      speedKmh: 40,
      ioData: { '239': 1, '240': 1 },
    }));
    const db = makeDb(
      [{ id: VEHICULO, plate: 'ABCD12', empresaId: EMPRESA }],
      // El servicio pide los más recientes primero; el mock devuelve este orden.
      [...puntos].reverse(),
    );
    const lista = await listarTrayectosTeltonika({
      db: db.db,
      logger,
      empresaId: EMPRESA,
      desde,
      hasta,
      page: 1,
      pageSize: 1,
      maxPuntos: 3,
    });
    expect(lista.truncado).toBe(true);
    expect(lista.total).toBe(1);
    expect(lista.trayectos).toHaveLength(1);
    expect(lista.trayectos[0]?.patente).toBe('ABCD12');
    expect(lista.trayectos[0]?.empresaId).toBe(EMPRESA);
    expect(lista.cta).toBeNull();
    expect(lista.ctaSensor).toBe(true);
  });

  it('marca robo con ignición on usando la hora del dispositivo, no el orden de subida', async () => {
    const t0 = Date.parse('2026-09-02T12:00:00.000Z');
    const db = makeDb(
      [{ id: VEHICULO, plate: 'ABCD12', empresaId: EMPRESA }],
      [
        {
          vehicleId: VEHICULO,
          timestampDevice: new Date(t0 + 12 * 60_000),
          latitude: '-33.46',
          longitude: '-70.66',
          speedKmh: 0,
          ioData: { '239': 1, '240': 0, '84': 500 },
        },
        {
          vehicleId: VEHICULO,
          timestampDevice: new Date(t0 + 60_000),
          latitude: '-33.451',
          longitude: '-70.66',
          speedKmh: 40,
          ioData: { '239': 1, '240': 1, '84': 800 },
        },
        {
          vehicleId: VEHICULO,
          timestampDevice: new Date(t0 + 10 * 60_000),
          latitude: '-33.46',
          longitude: '-70.66',
          speedKmh: 0,
          ioData: { '239': 1, '240': 0, '84': 800 },
        },
        {
          vehicleId: VEHICULO,
          timestampDevice: new Date(t0),
          latitude: '-33.45',
          longitude: '-70.66',
          speedKmh: 40,
          ioData: { '239': 1, '240': 1, '84': 800 },
        },
      ],
    );
    const lista = await listarTrayectosTeltonika({
      db: db.db,
      logger,
      empresaId: EMPRESA,
      desde,
      hasta,
      page: 1,
      pageSize: 20,
    });
    expect(lista.trayectos[0]?.posibleRoboCombustible).toBe(true);
  });

  it('avisa si io_data no es un objeto y no inventa litros', async () => {
    const t0 = Date.parse('2026-09-02T12:00:00.000Z');
    const db = makeDb(
      [{ id: VEHICULO, plate: 'ABCD12', empresaId: EMPRESA }],
      [
        {
          vehicleId: VEHICULO,
          timestampDevice: new Date(t0 + 120_000),
          latitude: '-33.47',
          longitude: '-70.66',
          speedKmh: 30,
          ioData: { '239': 1, '240': 1 },
        },
        {
          vehicleId: VEHICULO,
          timestampDevice: new Date(t0 + 60_000),
          latitude: '-33.46',
          longitude: '-70.66',
          speedKmh: 30,
          ioData: ['no-es-objeto'],
        },
        {
          vehicleId: VEHICULO,
          timestampDevice: new Date(t0),
          latitude: '-33.45',
          longitude: '-70.66',
          speedKmh: 30,
          ioData: { '239': 1, '240': 1 },
        },
      ],
    );
    const warn = vi.fn();
    const lista = await listarTrayectosTeltonika({
      db: db.db,
      logger: { ...logger, warn } as Logger,
      empresaId: EMPRESA,
      desde,
      hasta,
      page: 1,
      pageSize: 20,
    });
    expect(warn).toHaveBeenCalledOnce();
    expect(lista.trayectos[0]?.litrosIniciales).toBeNull();
    expect(lista.trayectos[0]?.posibleRoboCombustible).toBe(false);
  });
});
