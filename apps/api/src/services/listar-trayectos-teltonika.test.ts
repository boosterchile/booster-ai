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

function makeDb(
  vehiculos: unknown[],
  puntos: unknown[],
  umbrales: unknown[] = [{ umbralRoboGolpeL: null, umbralRoboHormigaL: null }],
) {
  let llamadas = 0;
  return {
    llamadas: () => llamadas,
    db: {
      select: vi.fn(() => {
        llamadas += 1;
        if (llamadas === 1) {
          return cadena(vehiculos);
        }
        if (llamadas === 2 && vehiculos.length > 0) {
          return cadena(umbrales);
        }
        return cadena(puntos);
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
      combustible: 'sin_dato',
    });
    expect(lista.truncado).toBe(true);
    expect(lista.total).toBe(1);
    expect(lista.totalSinCombustible).toBe(1);
    expect(lista.totalConCombustible).toBe(0);
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
          latitude: '-33.47',
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
    expect(lista.trayectos[0]?.eventLat).toBeCloseTo(-33.46, 5);
    expect(lista.trayectos[0]?.eventLon).toBeCloseTo(-70.66, 5);
  });

  it('expone el inicio de la ventana y null si esa ventana no tiene fix', async () => {
    const t0 = Date.parse('2026-09-02T12:00:00.000Z');
    const conGeo = makeDb(
      [{ id: VEHICULO, plate: 'ABCD12', empresaId: EMPRESA }],
      [
        {
          vehicleId: VEHICULO,
          timestampDevice: new Date(t0 + 12 * 60_000),
          latitude: '-33.48',
          longitude: '-70.70',
          speedKmh: 0,
          ioData: { '239': 0, '240': 0, '84': 590 },
        },
        {
          vehicleId: VEHICULO,
          timestampDevice: new Date(t0 + 10 * 60_000),
          latitude: '-33.40',
          longitude: '-70.60',
          speedKmh: 0,
          ioData: { '239': 0, '240': 0, '84': 800 },
        },
        {
          vehicleId: VEHICULO,
          timestampDevice: new Date(t0 + 60_000),
          latitude: '-33.47',
          longitude: '-70.66',
          speedKmh: 40,
          ioData: { '239': 1, '240': 1, '84': 790 },
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
    const listaGeo = await listarTrayectosTeltonika({
      db: conGeo.db,
      logger,
      empresaId: EMPRESA,
      desde,
      hasta,
      page: 1,
      pageSize: 20,
    });
    expect(listaGeo.trayectos[0]).toMatchObject({
      posibleRoboCombustible: true,
      eventLat: -33.4,
      eventLon: -70.6,
    });

    const sinGeo = makeDb(
      [{ id: VEHICULO, plate: 'ABCD12', empresaId: EMPRESA }],
      [
        {
          vehicleId: VEHICULO,
          timestampDevice: new Date(t0 + 12 * 60_000),
          latitude: null,
          longitude: null,
          speedKmh: 0,
          ioData: { '239': 0, '240': 0, '84': 590 },
        },
        {
          vehicleId: VEHICULO,
          timestampDevice: new Date(t0 + 10 * 60_000),
          latitude: '0',
          longitude: '0',
          speedKmh: 0,
          ioData: { '239': 0, '240': 0, '84': 800 },
        },
        {
          vehicleId: VEHICULO,
          timestampDevice: new Date(t0 + 60_000),
          latitude: '-33.47',
          longitude: '-70.66',
          speedKmh: 40,
          ioData: { '239': 1, '240': 1, '84': 790 },
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
    const listaSin = await listarTrayectosTeltonika({
      db: sinGeo.db,
      logger,
      empresaId: EMPRESA,
      desde,
      hasta,
      page: 1,
      pageSize: 20,
    });
    expect(listaSin.trayectos[0]).toMatchObject({
      posibleRoboCombustible: true,
      eventLat: null,
      eventLon: null,
    });
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
      combustible: 'sin_dato',
    });
    expect(warn).toHaveBeenCalledOnce();
    expect(lista.trayectos[0]?.litrosIniciales).toBeNull();
    expect(lista.trayectos[0]?.posibleRoboCombustible).toBe(false);
    expect(lista.trayectos[0]?.posibleRoboHormiga).toBe(false);
  });

  it('aplica el U_empresa persistido: 5 L marca y el default de 8 L no', async () => {
    const t0 = Date.parse('2026-09-02T12:00:00.000Z');
    const puntos = [
      {
        vehicleId: VEHICULO,
        timestampDevice: new Date(t0 + 12 * 60_000),
        latitude: '-33.42',
        longitude: '-70.62',
        speedKmh: 0,
        ioData: { '239': 0, '240': 0, '84': 450 },
      },
      {
        vehicleId: VEHICULO,
        timestampDevice: new Date(t0 + 10 * 60_000),
        latitude: '-33.42',
        longitude: '-70.62',
        speedKmh: 0,
        ioData: { '239': 0, '240': 0, '84': 500 },
      },
      {
        vehicleId: VEHICULO,
        timestampDevice: new Date(t0 + 60_000),
        latitude: '-33.47',
        longitude: '-70.66',
        speedKmh: 40,
        ioData: { '239': 1, '240': 1, '84': 500 },
      },
      {
        vehicleId: VEHICULO,
        timestampDevice: new Date(t0),
        latitude: '-33.45',
        longitude: '-70.66',
        speedKmh: 40,
        ioData: { '239': 1, '240': 1, '84': 500 },
      },
    ];
    const vehiculo = [{ id: VEHICULO, plate: 'ABCD12', empresaId: EMPRESA }];
    const conDefault = makeDb(vehiculo, puntos);
    const sinMarca = await listarTrayectosTeltonika({
      db: conDefault.db,
      logger,
      empresaId: EMPRESA,
      desde,
      hasta,
      page: 1,
      pageSize: 20,
    });
    expect(sinMarca.trayectos[0]?.posibleRoboCombustible).toBe(false);

    const conCinco = makeDb(vehiculo, puntos, [{ umbralRoboGolpeL: 5, umbralRoboHormigaL: null }]);
    const marcado = await listarTrayectosTeltonika({
      db: conCinco.db,
      logger,
      empresaId: EMPRESA,
      desde,
      hasta,
      page: 1,
      pageSize: 20,
    });
    expect(marcado.trayectos[0]).toMatchObject({
      posibleRoboCombustible: true,
      posibleRoboHormiga: false,
      eventLat: -33.42,
      eventLon: -70.62,
    });
  });

  it('separa los trayectos con dato de combustible de los sin dato y resume cada vehículo', async () => {
    const OTRO = '33333333-3333-4333-8333-333333333333';
    const t0 = Date.parse('2026-09-02T12:00:00.000Z');
    const puntos = [
      {
        vehicleId: OTRO,
        timestampDevice: new Date(t0 + 3 * 60_000),
        latitude: '-33.50',
        longitude: '-70.66',
        speedKmh: 40,
        ioData: { '239': 1, '240': 1 },
      },
      {
        vehicleId: OTRO,
        timestampDevice: new Date(t0 + 2 * 60_000),
        latitude: '-33.49',
        longitude: '-70.66',
        speedKmh: 40,
        ioData: { '239': 1, '240': 1 },
      },
      {
        vehicleId: VEHICULO,
        timestampDevice: new Date(t0 + 60_000),
        latitude: '-33.56',
        longitude: '-70.66',
        speedKmh: 40,
        ioData: { '239': 0, '240': 1, '85': 1200, '83': 581_570, '89': 58 },
      },
      {
        vehicleId: VEHICULO,
        timestampDevice: new Date(t0),
        latitude: '-33.45',
        longitude: '-70.66',
        speedKmh: 40,
        ioData: { '239': 0, '240': 1, '85': 1100, '83': 581_520, '89': 60 },
      },
    ];
    const vehiculos = [
      { id: VEHICULO, plate: 'RCPC20', empresaId: EMPRESA },
      { id: OTRO, plate: 'KZBB26', empresaId: EMPRESA },
    ];

    const conDato = await listarTrayectosTeltonika({
      db: makeDb(vehiculos, puntos).db,
      logger,
      empresaId: EMPRESA,
      desde,
      hasta,
      page: 1,
      pageSize: 20,
    });
    expect(conDato).toMatchObject({
      combustible: 'con_dato',
      total: 1,
      totalConCombustible: 1,
      totalSinCombustible: 1,
      ctaSensor: false,
      vehiculos: [
        { vehiculoId: OTRO, patente: 'KZBB26', combustible: 'sin_sensor' },
        { vehiculoId: VEHICULO, patente: 'RCPC20', combustible: 'consumo_can' },
      ],
    });
    expect(conDato.trayectos).toHaveLength(1);
    expect(conDato.trayectos[0]).toMatchObject({
      patente: 'RCPC20',
      fuenteCombustible: 'consumo_can',
      litrosConsumidos: 5,
      nivelPctInicial: 60,
      nivelPctFinal: 58,
    });
    expect(conDato.trayectos[0]?.kmPorLitro).toBeGreaterThan(0);

    const sinDato = await listarTrayectosTeltonika({
      db: makeDb(vehiculos, puntos).db,
      logger,
      empresaId: EMPRESA,
      desde,
      hasta,
      page: 1,
      pageSize: 20,
      combustible: 'sin_dato',
    });
    expect(sinDato.combustible).toBe('sin_dato');
    expect(sinDato.total).toBe(1);
    expect(sinDato.trayectos.map((t) => t.patente)).toEqual(['KZBB26']);
    expect(sinDato.trayectos[0]?.fuenteCombustible).toBeNull();
  });

  it('no emite el aviso si el trayecto es corto o el AVL 89 está bajo 14 %', async () => {
    const t0 = Date.parse('2026-09-02T12:00:00.000Z');
    const vehiculo = [{ id: VEHICULO, plate: 'JLKT54', empresaId: EMPRESA }];
    const corto = makeDb(vehiculo, [
      {
        vehicleId: VEHICULO,
        timestampDevice: new Date(t0 + 12 * 60_000),
        latitude: '-30.3078',
        longitude: '-71.5117',
        speedKmh: 0,
        ioData: { '239': 0, '240': 0, '84': 600, '89': 30 },
      },
      {
        vehicleId: VEHICULO,
        timestampDevice: new Date(t0 + 10 * 60_000),
        latitude: '-30.3078',
        longitude: '-71.5117',
        speedKmh: 0,
        ioData: { '239': 0, '240': 0, '84': 800, '89': 40 },
      },
      {
        vehicleId: VEHICULO,
        timestampDevice: new Date(t0 + 60_000),
        latitude: '-33.451',
        longitude: '-70.66',
        speedKmh: 40,
        ioData: { '239': 1, '240': 1, '84': 800, '89': 40 },
      },
      {
        vehicleId: VEHICULO,
        timestampDevice: new Date(t0),
        latitude: '-33.45',
        longitude: '-70.66',
        speedKmh: 40,
        ioData: { '239': 1, '240': 1, '84': 800, '89': 40 },
      },
    ]);
    const sinBadgeCorto = await listarTrayectosTeltonika({
      db: corto.db,
      logger,
      empresaId: EMPRESA,
      desde,
      hasta,
      page: 1,
      pageSize: 20,
    });
    expect(sinBadgeCorto.trayectos[0]?.distanciaKm).toBeLessThan(1);
    expect(sinBadgeCorto.trayectos[0]).toMatchObject({
      posibleRoboCombustible: false,
      posibleRoboHormiga: false,
      eventLat: null,
      eventLon: null,
    });

    const tanqueBajo = makeDb(vehiculo, [
      {
        vehicleId: VEHICULO,
        timestampDevice: new Date(t0 + 12 * 60_000),
        latitude: '-30.3078',
        longitude: '-71.5117',
        speedKmh: 0,
        ioData: { '239': 0, '240': 0, '84': 1600, '89': 8 },
      },
      {
        vehicleId: VEHICULO,
        timestampDevice: new Date(t0 + 10 * 60_000),
        latitude: '-30.3078',
        longitude: '-71.5117',
        speedKmh: 0,
        ioData: { '239': 0, '240': 0, '84': 2000, '89': 10 },
      },
      {
        vehicleId: VEHICULO,
        timestampDevice: new Date(t0 + 60_000),
        latitude: '-33.47',
        longitude: '-70.66',
        speedKmh: 40,
        ioData: { '239': 1, '240': 1, '84': 2000, '89': 10 },
      },
      {
        vehicleId: VEHICULO,
        timestampDevice: new Date(t0),
        latitude: '-33.45',
        longitude: '-70.66',
        speedKmh: 40,
        ioData: { '239': 1, '240': 1, '84': 2000, '89': 10 },
      },
    ]);
    const sinBadgeBajo = await listarTrayectosTeltonika({
      db: tanqueBajo.db,
      logger,
      empresaId: EMPRESA,
      desde,
      hasta,
      page: 1,
      pageSize: 20,
    });
    expect(sinBadgeBajo.trayectos[0]?.distanciaKm).toBeGreaterThanOrEqual(1);
    expect(sinBadgeBajo.trayectos[0]).toMatchObject({
      posibleRoboCombustible: false,
      posibleRoboHormiga: false,
      eventLat: null,
      eventLon: null,
    });
  });

  it('sin vehículos devuelve los totales en cero y el resumen vacío', async () => {
    const lista = await listarTrayectosTeltonika({
      db: makeDb([], []).db,
      logger,
      empresaId: EMPRESA,
      desde,
      hasta,
      page: 1,
      pageSize: 20,
      combustible: 'sin_dato',
    });
    expect(lista).toMatchObject({
      combustible: 'sin_dato',
      total: 0,
      totalConCombustible: 0,
      totalSinCombustible: 0,
      vehiculos: [],
    });
  });
});
