import { beforeEach, describe, expect, it, vi } from 'vitest';

// El recorrido contra PostgreSQL está en
// test/integration/reemision-distancia-no-plausible.integration.test.ts; aquí, las ramas.
const m = vi.hoisted(() => ({ rutaCompartidaDelViaje: vi.fn() }));
vi.mock('../../src/services/ruta-compartida.js', () => ({
  rutaCompartidaDelViaje: m.rutaCompartidaDelViaje,
}));

const { CorreccionConcurrenteError, corregirDistanciaNoPlausible, prepararCorreccion } =
  await import('../../src/services/corregir-distancia-no-plausible.js');

type Filas = Record<string, unknown>[];
const consulta = (filas: Filas) => {
  const cadena: Promise<Filas> & Record<string, () => unknown> = Object.assign(
    Promise.resolve(filas),
    {
      from: () => cadena,
      where: () => cadena,
      limit: () => cadena,
      innerJoin: () => cadena,
      orderBy: () => cadena,
    },
  );
  return cadena;
};

/**
 * SELECTs en orden: viaje, métricas, [métricas de la ruta, viajes de la ruta],
 * [solicitante]. Cada UPDATE de la transacción devuelve la guarda siguiente
 * (una fila por defecto).
 */
function baseFalsa(cola: Filas[], guardas: Filas[] = []) {
  const pendientes = [...cola];
  const restantes = [...guardas];
  const sets: Record<string, unknown>[] = [];
  const insertados: Record<string, unknown>[] = [];
  const tx = {
    update: vi.fn(() => ({
      set: (v: Record<string, unknown>) => {
        sets.push(v);
        return { where: () => ({ returning: async () => restantes.shift() ?? [{ id: 'x' }] }) };
      },
    })),
    insert: vi.fn(() => ({
      values: vi.fn(async (v: Record<string, unknown>) => {
        insertados.push(v);
      }),
    })),
  };
  const db = {
    select: vi.fn(() => consulta(pendientes.shift() ?? [])),
    transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
  };
  return { db: db as never, sets, insertados, tx };
}

const noop = (): void => undefined;
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: noop } as never;
const EMITIDO = new Date('2026-09-14T21:40:40Z');
const RECOGIDO = new Date('2026-11-16T02:29:30Z');

const VIAJE = { id: 'v', trackingCode: 'BOO-SOLO', status: 'entregado' };
/** BOO-BKAXIK: 2,51 km medidos por Teltonika de 500 estimados. */
const SOLO = {
  tripId: 'v',
  distanceKmEstimated: '500.00',
  distanceKmActual: '2.51',
  carbonEmissionsKgco2eEstimated: '33.475',
  carbonEmissionsKgco2eActual: '2.691',
  routeDataSource: 'teltonika_gps',
  coveragePct: '100.00',
  precisionMethod: 'modelado',
  certificateIssuedAt: EMITIDO,
};
/** La ruta de prueba: 0,03 km de 37,75, dos cargas y una cancelada sin recoger. */
const RUTA = {
  rutaId: 'r',
  distanceKmEstimated: '37.75',
  distanceKmActual: '0.03',
  carbonEmissionsKgco2eEstimated: '28.991',
  carbonEmissionsKgco2eActual: '0.021',
  routeDataSource: 'movil_gps',
  coveragePct: '100.00',
  precisionMethod: 'por_defecto',
};
const VIAJE_A = { id: 'a', trackingCode: 'BOO-4FF3XA', status: 'entregado' };
const VIAJE_B = { id: 'b', trackingCode: 'BOO-VZYIN2', status: 'entregado' };
const VIAJE_C = { id: 'c', trackingCode: 'BOO-CANCEL', status: 'cancelado' };
const metricasDeRuta = (tripId: string, estimadas: string, reales: string | null) => ({
  tripId,
  distanceKmEstimated: '11.69',
  distanceKmActual: null,
  carbonEmissionsKgco2eEstimated: estimadas,
  carbonEmissionsKgco2eActual: reales,
  routeDataSource: 'movil_gps',
  coveragePct: '100.00',
  precisionMethod: 'por_defecto',
  certificateIssuedAt: reales === null ? null : EMITIDO,
  rutaId: 'r',
});
const M_A = metricasDeRuta('a', '20.864', '0.015');
const M_B = metricasDeRuta('b', '8.127', '0.006');
const M_C = { ...metricasDeRuta('c', '5.000', null), certificateIssuedAt: null };
const FILAS_RUTA = [
  { trip: VIAJE_A, metrics: M_A, pickedUpAt: RECOGIDO },
  { trip: VIAJE_B, metrics: M_B, pickedUpAt: RECOGIDO },
  { trip: VIAJE_C, metrics: M_C, pickedUpAt: null },
];

const preparar = (db: never, tripId = 'v') => prepararCorreccion({ db, logger, tripId });
const corregir = (db: never, tripId = 'v', solicitadoPorUserId: string | null = null) =>
  corregirDistanciaNoPlausible({ db, logger, tripId, solicitadoPorUserId });

beforeEach(() => {
  vi.clearAllMocks();
  m.rutaCompartidaDelViaje.mockResolvedValue(null);
});

describe('prepararCorreccion — viaje solo', () => {
  it('viaje inexistente, no entregado o sin métricas', async () => {
    expect(await preparar(baseFalsa([[]]).db)).toMatchObject({ code: 'trip_not_found' });
    expect(await preparar(baseFalsa([[{ ...VIAJE, status: 'asignado' }]]).db)).toMatchObject({
      code: 'trip_not_delivered',
    });
    expect(await preparar(baseFalsa([[VIAJE], []]).db)).toMatchObject({
      code: 'metrics_missing',
    });
  });

  it('sin distancia medida no hay nada que corregir', async () => {
    const { db } = baseFalsa([[VIAJE], [{ ...SOLO, distanceKmActual: null }]]);
    expect(await preparar(db)).toMatchObject({ code: 'sin_distancia_medida' });
  });

  it('una distancia plausible no se toca (BOO-YWKZWR: 504,72 de 464,85)', async () => {
    const { db } = baseFalsa([
      [VIAJE],
      [{ ...SOLO, distanceKmEstimated: '464.85', distanceKmActual: '504.72' }],
    ]);
    expect(await preparar(db)).toMatchObject({ code: 'distancia_plausible' });
  });

  it('sin estimación no habría cifra que publicar', async () => {
    const { db } = baseFalsa([[VIAJE], [{ ...SOLO, carbonEmissionsKgco2eEstimated: null }]]);
    expect(await preparar(db)).toMatchObject({ code: 'sin_estimacion' });
  });

  it('2,51 km de 500 (BOO-BKAXIK): el plan corrige el viaje solo', async () => {
    const { db } = baseFalsa([[VIAJE], [SOLO]]);
    expect(await preparar(db)).toEqual({
      ok: true,
      plan: {
        unidad: 'viaje',
        rutaId: null,
        distanciaMedidaKm: 2.51,
        distanciaReferenciaKm: 500,
        minimoPct: 50,
        fuenteAnterior: 'teltonika_gps',
        nivel: 'secundario_modeled',
        incertidumbre: 0.35,
        viajes: [
          {
            tripId: 'v',
            trackingCode: 'BOO-SOLO',
            certificadoEmitido: true,
            emisionesKgco2eReales: 2.691,
            emisionesKgco2eEstimadas: 33.475,
          },
        ],
      },
    });
  });

  it('sin referencia, la distancia medida tampoco cuenta: se corrige', async () => {
    const { db } = baseFalsa([[VIAJE], [{ ...SOLO, distanceKmEstimated: null }]]);
    expect(await preparar(db)).toMatchObject({
      ok: true,
      plan: { unidad: 'viaje', distanciaReferenciaKm: null },
    });
  });
});

describe('prepararCorreccion — ruta compartida', () => {
  beforeEach(() => {
    m.rutaCompartidaDelViaje.mockResolvedValue({ rutaId: 'r', cerrada: true });
  });

  it('la ruta tiene que estar cerrada y tener métricas', async () => {
    m.rutaCompartidaDelViaje.mockResolvedValueOnce({ rutaId: 'r', cerrada: false });
    expect(await preparar(baseFalsa([[VIAJE_A], [M_A]]).db, 'a')).toMatchObject({
      code: 'ruta_no_cerrada',
    });
    expect(await preparar(baseFalsa([[VIAJE_A], [M_A], []]).db, 'a')).toMatchObject({
      code: 'ruta_sin_metricas',
    });
  });

  it('mide la ruta, no el viaje: 0,03 km de 37,75 corrige las dos cargas recogidas', async () => {
    const { db } = baseFalsa([[VIAJE_A], [M_A], [RUTA], FILAS_RUTA]);
    expect(await preparar(db, 'a')).toEqual({
      ok: true,
      plan: {
        unidad: 'ruta',
        rutaId: 'r',
        distanciaMedidaKm: 0.03,
        distanciaReferenciaKm: 37.75,
        minimoPct: 50,
        fuenteAnterior: 'movil_gps',
        nivel: 'secundario_modeled',
        incertidumbre: 0.35,
        viajes: [
          {
            tripId: 'a',
            trackingCode: 'BOO-4FF3XA',
            certificadoEmitido: true,
            emisionesKgco2eReales: 0.015,
            emisionesKgco2eEstimadas: 20.864,
          },
          {
            tripId: 'b',
            trackingCode: 'BOO-VZYIN2',
            certificadoEmitido: true,
            emisionesKgco2eReales: 0.006,
            emisionesKgco2eEstimadas: 8.127,
          },
        ],
      },
    });
  });

  it('una ruta ya corregida (sin distancia medida) no se vuelve a tocar', async () => {
    const { db } = baseFalsa([[VIAJE_A], [M_A], [{ ...RUTA, distanceKmActual: null }]]);
    expect(await preparar(db, 'a')).toMatchObject({ code: 'sin_distancia_medida' });
  });

  it('con una ruta plausible no se toca aunque la carga tenga cifras reales', async () => {
    const { db } = baseFalsa([[VIAJE_A], [M_A], [{ ...RUTA, distanceKmActual: '30.00' }]]);
    expect(await preparar(db, 'a')).toMatchObject({ code: 'distancia_plausible' });
  });
});

describe('corregirDistanciaNoPlausible — escritura', () => {
  it('ruta: deja la ruta y cada carga como el cierre sin medición, y un evento por carga', async () => {
    m.rutaCompartidaDelViaje.mockResolvedValue({ rutaId: 'r', cerrada: true });
    const { db, sets, insertados } = baseFalsa([[VIAJE_A], [M_A], [RUTA], FILAS_RUTA]);
    const r = await corregir(db, 'a');

    expect(r).toMatchObject({ ok: true, plan: { unidad: 'ruta' } });
    expect(sets).toHaveLength(3);
    expect(sets[0]).toMatchObject({
      distanceKmActual: null,
      carbonEmissionsKgco2eActual: null,
      fuelConsumedLActual: null,
      emisionesKgco2eTtw: null,
      emisionesKgco2eWtt: null,
      intensidadGco2ePorTkm: null,
      routeDataSource: 'maps_directions',
      coveragePct: '0',
      certificationLevel: 'secundario_modeled',
      uncertaintyFactor: '0.35',
    });
    expect(sets[0]).not.toHaveProperty('motivoFallback');
    for (const set of sets.slice(1)) {
      expect(set).toMatchObject({
        distanceKmActual: null,
        carbonEmissionsKgco2eActual: null,
        fuelConsumedLActual: null,
        emisionesKgco2eTtw: null,
        emisionesKgco2eWtt: null,
        intensidadGco2ePorTkm: null,
        routeDataSource: 'maps_directions',
        coveragePct: '0',
        certificationLevel: 'secundario_modeled',
        uncertaintyFactor: '0.35',
        fuenteDistancia: 'routes_estimada',
        motivoFallback: 'distancia_no_plausible',
        decisionVersion: 3,
      });
    }
    expect(insertados).toHaveLength(2);
    expect(insertados[0]).toMatchObject({
      tripId: 'a',
      eventType: 'carbono_calculado',
      source: 'sistema',
      recordedByUserId: null,
      payload: {
        correccion: 'distancia_medida_no_plausible',
        motivo_fallback: 'distancia_no_plausible',
        unidad: 'ruta',
        ruta_id: 'r',
        distancia_medida_km: 0.03,
        distancia_referencia_km: 37.75,
        minimo_pct: 50,
        fuente_distancia_anterior: 'movil_gps',
        emisiones_kgco2e_reales_anterior: 0.015,
        emisiones_kgco2e_estimadas: 20.864,
        certificado_emitido: true,
        decision_version: 3,
      },
    });
    expect(insertados[1]).toMatchObject({
      tripId: 'b',
      payload: { emisiones_kgco2e_estimadas: 8.127 },
    });
  });

  it('viaje solo: una sola fila corregida, sin tocar ninguna ruta', async () => {
    const { db, sets, insertados } = baseFalsa([[VIAJE], [SOLO]]);
    await expect(corregir(db)).resolves.toMatchObject({ ok: true });
    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatchObject({ motivoFallback: 'distancia_no_plausible' });
    expect(insertados[0]).toMatchObject({
      tripId: 'v',
      payload: { unidad: 'viaje', ruta_id: null, fuente_distancia_anterior: 'teltonika_gps' },
    });
  });

  it('si una fila ya no está como se leyó, falla como concurrente sin dejar eventos', async () => {
    m.rutaCompartidaDelViaje.mockResolvedValue({ rutaId: 'r', cerrada: true });
    const { db, insertados } = baseFalsa(
      [[VIAJE_A], [M_A], [RUTA], FILAS_RUTA],
      [[{ id: 'r' }], []],
    );
    await expect(corregir(db, 'a')).rejects.toBeInstanceOf(CorreccionConcurrenteError);
    expect(insertados).toHaveLength(0);
  });

  it('con un solicitante, queda en el evento; si no existe, no escribe', async () => {
    const conPo = baseFalsa([[VIAJE], [SOLO], [{ id: 'po' }]]);
    await expect(corregir(conPo.db, 'v', 'po')).resolves.toMatchObject({ ok: true });
    expect(conPo.insertados[0]).toMatchObject({ recordedByUserId: 'po' });

    const sinPo = baseFalsa([[VIAJE], [SOLO], []]);
    await expect(corregir(sinPo.db, 'v', 'po')).resolves.toMatchObject({
      code: 'solicitante_no_existe',
    });
    expect(sinPo.tx.update).not.toHaveBeenCalled();
  });

  it('lo que no se corregiría tampoco se escribe', async () => {
    const { db, tx } = baseFalsa([[VIAJE], [{ ...SOLO, distanceKmActual: null }]]);
    await expect(corregir(db)).resolves.toMatchObject({ code: 'sin_distancia_medida' });
    expect(tx.update).not.toHaveBeenCalled();
  });
});
