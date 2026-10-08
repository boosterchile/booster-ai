import { beforeEach, describe, expect, it, vi } from 'vitest';

const { counterAdd, histogramRecord } = vi.hoisted(() => ({
  counterAdd: vi.fn(),
  histogramRecord: vi.fn(),
}));
vi.mock('../observability/business-metrics.js', () => ({
  getBusinessCounter: () => ({ add: counterAdd }),
  getBusinessHistogram: () => ({ record: histogramRecord }),
}));
vi.mock('../observability/business-span.js', () => ({
  withBusinessSpan: async (_o: unknown, fn: (s: unknown) => Promise<unknown>) => fn({}),
  setResultAttributes: vi.fn(),
}));

const {
  combustibleARoutesEmissionType,
  evaluarEcoRoutingAsignacion,
  obtenerSugerenciaRutaActiva,
  registrarRespuestaSugerenciaRuta,
  textoSugerencia,
} = await import('./eco-routing-tiempo-real.js');
const { RoutesApiError } = await import('./routes-api.js');

/**
 * Unit del orquestador con una BD simulada por colas: cada `select` consume
 * la siguiente respuesta. El comportamiento contra Postgres real lo cubre
 * `test/integration/eco-routing-tiempo-real.integration.test.ts`.
 */
function makeDb(selects: unknown[][], opts: { returning?: unknown[][] } = {}) {
  const cola = [...selects];
  const returning = [...(opts.returning ?? [])];
  const inserted: unknown[] = [];
  const updated: unknown[] = [];
  const chain = (): Record<string, unknown> => {
    const c: Record<string, unknown> = {};
    for (const m of ['from', 'innerJoin', 'leftJoin', 'where', 'orderBy']) {
      c[m] = vi.fn(() => c);
    }
    c.limit = vi.fn(async () => cola.shift() ?? []);
    c.then = (resolve: (v: unknown) => unknown) => resolve(cola.shift() ?? []);
    return c;
  };
  return {
    inserted,
    updated,
    select: vi.fn(() => chain()),
    insert: vi.fn(() => ({
      values: vi.fn((v: unknown) => {
        inserted.push(v);
        return { returning: vi.fn(async () => returning.shift() ?? [{ id: 'sug-1' }]) };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((v: unknown) => {
        updated.push(v);
        const w = {
          where: vi.fn(() =>
            Object.assign(Promise.resolve(undefined), {
              returning: vi.fn(async () => returning.shift() ?? [{ id: 'sug-1' }]),
            }),
          ),
        };
        return w;
      }),
    })),
  };
}

const noop = (): void => undefined;
const logger = {
  trace: noop,
  debug: noop,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: noop,
} as never;

const NOW = Date.parse('2026-10-08T15:00:00Z');
const CTX = {
  status: 'recogido',
  driverUserId: 'driver-1',
  vehicleId: 'veh-1',
  tripId: 'trip-1',
  originLatitude: '-33.4100000',
  originLongitude: '-70.5800000',
  destinationAddressRaw: 'Viña del Mar',
  fuelType: 'diesel',
  consumo: '30.00',
};
/** 8 muestras lentas cada 10 s hasta NOW-1s, del móvil. */
const LENTAS = [40, 8, 5, 3, 6, 4, 7, 5].map((v, i) => ({
  ts: new Date(NOW - 71_000 + i * 10_000),
  lat: '-33.0500000',
  lng: '-71.4000000',
  speed: v.toFixed(2),
}));
const ruta = (d: number, km: number, l: number | null, p: string) => ({
  distanceKm: km,
  durationS: d,
  fuelL: l,
  polylineEncoded: p,
  startLocation: null,
});

function deps(rutas: unknown) {
  return {
    computeRoutes: vi.fn(async () => {
      if (rutas instanceof Error) {
        throw rutas;
      }
      return rutas as ReturnType<typeof ruta>[];
    }),
    sendPush: vi.fn(async () => ({ sent: 1, invalidated: 0, errored: 0 })),
    now: () => NOW,
    throttle: new Map<string, number>(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('helpers', () => {
  it.each([
    ['diesel', 'DIESEL'],
    ['gasolina', 'GASOLINE'],
    ['gas_glp', 'GASOLINE'],
    ['gas_gnc', 'GASOLINE'],
    ['electrico', 'ELECTRIC'],
    ['hidrogeno', 'ELECTRIC'],
    ['hibrido_diesel', 'HYBRID'],
    ['hibrido_gasolina', 'HYBRID'],
    [null, undefined],
  ])('combustible %s → %s', (c, e) => {
    expect(combustibleARoutesEmissionType(c)).toBe(e);
  });

  it('texto de la sugerencia según ahorros', () => {
    expect(textoSugerencia(300, 4.25)).toBe(
      'Hay una ruta alternativa: 5 min menos y 4,3 kg CO₂e menos.',
    );
    expect(textoSugerencia(-120, 2)).toBe(
      'Hay una ruta alternativa: 2 min más y 2,0 kg CO₂e menos.',
    );
    expect(textoSugerencia(20, null)).toBe('Hay una ruta alternativa con menos emisiones.');
  });
});

describe('evaluarEcoRoutingAsignacion', () => {
  const MEJOR = [ruta(3600, 60, 20, 'actual'), ruta(3700, 52, 15, 'alt')];

  it('sugerida: persiste, empuja y marca enviada_en + histograma', async () => {
    const db = makeDb([[CTX], [], LENTAS, []]);
    const d = deps(MEJOR);
    const r = await evaluarEcoRoutingAsignacion({
      db: db as never,
      logger,
      assignmentId: 'a-1',
      routesProjectId: 'p',
      deps: d,
    });
    expect(r).toEqual({ resultado: 'sugerida', sugerenciaId: 'sug-1', pushEnviados: 1 });
    expect(db.inserted[0]).toMatchObject({
      estado: 'sugerida',
      motivo: 'emisiones',
      alternativePolyline: 'alt',
    });
    expect(db.updated[0]).toEqual({ sentAt: new Date(NOW) });
    expect(histogramRecord).toHaveBeenCalledWith(0);
    expect(counterAdd).toHaveBeenCalledWith(1, { resultado: 'sugerida' });
  });

  it('sugerida sin suscripción push: no marca enviada_en', async () => {
    const db = makeDb([[CTX], [], LENTAS, []]);
    const d = deps(MEJOR);
    d.sendPush.mockResolvedValueOnce({ sent: 0, invalidated: 0, errored: 0 });
    const r = await evaluarEcoRoutingAsignacion({
      db: db as never,
      logger,
      assignmentId: 'a-1',
      deps: d,
    });
    expect(r).toMatchObject({ resultado: 'sugerida', pushEnviados: 0 });
    expect(db.updated).toHaveLength(0);
  });

  it('usa telemetría Teltonika y descarta puntos sin fix', async () => {
    const tel = LENTAS.map((p) => ({ ...p, speed: Number(p.speed) }));
    const db = makeDb([
      [CTX],
      [],
      [],
      [...tel, { ts: new Date(NOW - 5_000), lat: null, lng: null, speed: 3 }],
    ]);
    const r = await evaluarEcoRoutingAsignacion({
      db: db as never,
      logger,
      assignmentId: 'a-1',
      deps: deps(MEJOR),
    });
    expect(r.resultado).toBe('sugerida');
  });

  it('sin vehículo: solo móvil, sin consulta de telemetría', async () => {
    const db = makeDb([
      [
        {
          ...CTX,
          vehicleId: null,
          fuelType: null,
          consumo: null,
          originLatitude: null,
          originLongitude: null,
        },
      ],
      [],
      LENTAS,
    ]);
    const d = deps([ruta(3600, 60, null, 'actual'), ruta(3000, 60, null, 'alt')]);
    const r = await evaluarEcoRoutingAsignacion({
      db: db as never,
      logger,
      assignmentId: 'a-1',
      deps: d,
    });
    expect(r.resultado).toBe('sugerida');
    expect(db.inserted[0]).toMatchObject({
      motivo: 'tiempo',
      savingKgco2e: null,
      currentKgco2e: null,
    });
    expect(d.computeRoutes).toHaveBeenCalledWith(
      expect.not.objectContaining({ emissionType: expect.anything() }),
    );
  });

  it('Routes API sin rutas → congestión sin alternativa', async () => {
    const db = makeDb([[CTX], [], LENTAS, []]);
    const r = await evaluarEcoRoutingAsignacion({
      db: db as never,
      logger,
      assignmentId: 'a-1',
      deps: deps([]),
    });
    expect(r).toEqual({ resultado: 'congestion_sin_alternativa', sugerenciaId: 'sug-1' });
  });

  it('viaje no recogido, throttle y cooldown cortan antes de Routes API', async () => {
    const d = deps(MEJOR);
    expect(
      (
        await evaluarEcoRoutingAsignacion({
          db: makeDb([[{ ...CTX, status: 'asignado' }]]) as never,
          logger,
          assignmentId: 'a-1',
          deps: d,
        })
      ).resultado,
    ).toBe('viaje_no_activo');
    expect(
      (
        await evaluarEcoRoutingAsignacion({
          db: makeDb([]) as never,
          logger,
          assignmentId: 'a-1',
          deps: d,
        })
      ).resultado,
    ).toBe('throttle');
    expect(
      (
        await evaluarEcoRoutingAsignacion({
          db: makeDb([[CTX], [{ id: 'x' }]]) as never,
          logger,
          assignmentId: 'a-2',
          deps: d,
        })
      ).resultado,
    ).toBe('cooldown');
    expect(
      (
        await evaluarEcoRoutingAsignacion({
          db: makeDb([]) as never,
          logger,
          assignmentId: 'a-3',
          deps: d,
        })
      ).resultado,
    ).toBe('viaje_no_activo');
    expect(d.computeRoutes).not.toHaveBeenCalled();
  });

  it('error de Routes API tipado → error_routes; otro error se propaga', async () => {
    const r = await evaluarEcoRoutingAsignacion({
      db: makeDb([[CTX], [], LENTAS, []]) as never,
      logger,
      assignmentId: 'a-1',
      deps: deps(new RoutesApiError('quota', 'quota_exceeded', 429)),
    });
    expect(r.resultado).toBe('error_routes');
    await expect(
      evaluarEcoRoutingAsignacion({
        db: makeDb([[CTX], [], LENTAS, []]) as never,
        logger,
        assignmentId: 'a-1',
        deps: deps(new Error('boom')),
      }),
    ).rejects.toThrow('boom');
  });

  it('INSERT sin fila devuelta → error explícito', async () => {
    const db = makeDb([[CTX], [], LENTAS, []], { returning: [[]] });
    await expect(
      evaluarEcoRoutingAsignacion({
        db: db as never,
        logger,
        assignmentId: 'a-1',
        deps: deps(MEJOR),
      }),
    ).rejects.toThrow('no devolvió fila');
  });
});

describe('obtenerSugerenciaRutaActiva', () => {
  it('mapea la fila vigente', async () => {
    const fila = {
      id: 's',
      motivo: 'tiempo',
      polyline: 'p',
      ahorroSegundos: 600,
      ahorroKgco2e: null,
      detectadaEn: new Date(NOW),
    };
    expect(
      await obtenerSugerenciaRutaActiva({
        db: makeDb([[fila]]) as never,
        assignmentId: 'a',
        userId: 'u',
        nowMs: NOW,
      }),
    ).toEqual({
      id: 's',
      motivo: 'tiempo',
      polylineAlternativa: 'p',
      ahorroSegundos: 600,
      ahorroKgco2e: null,
      detectadaEn: new Date(NOW),
      texto: 'Hay una ruta alternativa: 10 min menos.',
    });
  });

  it('null sin fila o con fila incompleta', async () => {
    expect(
      await obtenerSugerenciaRutaActiva({
        db: makeDb([[]]) as never,
        assignmentId: 'a',
        userId: 'u',
        nowMs: NOW,
      }),
    ).toBeNull();
    const incompleta = {
      id: 's',
      motivo: null,
      polyline: null,
      ahorroSegundos: null,
      ahorroKgco2e: '1.000',
      detectadaEn: new Date(NOW),
    };
    expect(
      await obtenerSugerenciaRutaActiva({
        db: makeDb([[incompleta]]) as never,
        assignmentId: 'a',
        userId: 'u',
        nowMs: NOW,
      }),
    ).toBeNull();
  });
});

describe('registrarRespuestaSugerenciaRuta', () => {
  const base = {
    assignmentId: 'a',
    sugerenciaId: 's',
    userId: 'driver-1',
    respuesta: 'aceptada' as const,
    nowMs: NOW,
  };

  it('ok la primera vez y cuenta la respuesta', async () => {
    const db = makeDb([[{ driverUserId: 'driver-1', estado: 'sugerida', respuesta: null }]]);
    expect(await registrarRespuestaSugerenciaRuta({ ...base, db: db as never })).toBe('ok');
    expect(counterAdd).toHaveBeenCalledWith(1, { respuesta: 'aceptada' });
  });

  it('not_found, forbidden y ya_respondida', async () => {
    expect(await registrarRespuestaSugerenciaRuta({ ...base, db: makeDb([[]]) as never })).toBe(
      'not_found',
    );
    expect(
      await registrarRespuestaSugerenciaRuta({
        ...base,
        db: makeDb([
          [{ driverUserId: 'd', estado: 'congestion_sin_alternativa', respuesta: null }],
        ]) as never,
      }),
    ).toBe('not_found');
    expect(
      await registrarRespuestaSugerenciaRuta({
        ...base,
        db: makeDb([[{ driverUserId: 'otro', estado: 'sugerida', respuesta: null }]]) as never,
      }),
    ).toBe('forbidden');
    expect(
      await registrarRespuestaSugerenciaRuta({
        ...base,
        db: makeDb([
          [{ driverUserId: 'driver-1', estado: 'sugerida', respuesta: 'rechazada' }],
        ]) as never,
      }),
    ).toBe('ya_respondida');
  });

  it('carrera: el UPDATE condicionado no afecta filas → ya_respondida', async () => {
    const db = makeDb([[{ driverUserId: 'driver-1', estado: 'sugerida', respuesta: null }]], {
      returning: [[]],
    });
    expect(await registrarRespuestaSugerenciaRuta({ ...base, db: db as never })).toBe(
      'ya_respondida',
    );
  });
});
