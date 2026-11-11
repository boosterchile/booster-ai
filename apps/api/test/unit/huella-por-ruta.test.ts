import { calcularEmisionesViaje } from '@booster-ai/carbon-calculator';
import { describe, expect, it, vi } from 'vitest';
import { metricasRuta, tripMetrics } from '../../src/db/schema.js';
import {
  type ParametrosServicioSolo,
  calcularHuellaDeRuta,
  calcularHuellaDeServicioSolo,
  guardarMetricasDeRuta,
} from '../../src/services/huella-por-ruta.js';

/**
 * huella-consolidada parte 3 (ADR-089): el cálculo de un viaje pasa por su
 * ruta. Mientras toda ruta tenga un solo servicio, la parte del servicio es
 * el 100 % de la ruta y las cifras son las del cálculo por viaje.
 */
const VEHICULO = {
  combustible: 'diesel',
  consumoBasePor100km: 32,
  pesoVacioKg: 10_000,
  capacidadKg: 20_000,
} as const;

const CASOS: [string, ParametrosServicioSolo][] = [
  ['modelado', { metodo: 'modelado', distanciaKm: 350, cargaKg: 12_000, vehiculo: VEHICULO }],
  [
    'por defecto',
    { metodo: 'por_defecto', distanciaKm: 464.85, cargaKg: 10_000, tipoVehiculo: 'camion_pesado' },
  ],
  [
    'combustible medido',
    {
      metodo: 'exacto_canbus',
      distanciaKm: 504.72,
      cargaKg: 20_000,
      combustibleConsumido: 182.3,
      vehiculo: VEHICULO,
    },
  ],
  ['sin carga', { metodo: 'modelado', distanciaKm: 120, cargaKg: 0, vehiculo: VEHICULO }],
  ['sin distancia', { metodo: 'modelado', distanciaKm: 0, cargaKg: 5_000, vehiculo: VEHICULO }],
];

describe('calcularHuellaDeServicioSolo', () => {
  it.each(CASOS)('%s: la parte del servicio es el cálculo por viaje de hoy', (_nombre, params) => {
    const { emisiones } = calcularHuellaDeServicioSolo('viaje-1', params);
    expect(emisiones).toEqual(calcularEmisionesViaje(params));
  });

  it.each(CASOS)('%s: el servicio se lleva toda la ruta', (_nombre, params) => {
    const { emisiones, ruta, reparto } = calcularHuellaDeServicioSolo('viaje-1', params);
    expect(reparto.participacionPct).toBe(100);
    expect(reparto.versionMetodo).toBe('tkm-distancia-directa-v1');
    expect(emisiones.emisionesKgco2eWtw).toBe(ruta.emisionesKgco2eWtw);
    expect(emisiones.emisionesKgco2eTtw).toBe(ruta.emisionesKgco2eTtw);
    expect(emisiones.emisionesKgco2eWtt).toBe(ruta.emisionesKgco2eWtt);
  });

  it('la actividad es la masa por la distancia, en toneladas-kilómetro', () => {
    const { reparto, ruta } = calcularHuellaDeServicioSolo('viaje-1', {
      metodo: 'modelado',
      distanciaKm: 350,
      cargaKg: 12_000,
      vehiculo: VEHICULO,
    });
    expect(reparto.actividadTkm).toBe(4_200);
    expect(ruta.actividadTkm).toBe(4_200);
  });
});

/**
 * Criterio 3 de la spec, con los insumos de los 8 certificados emitidos en
 * producción al 2026-11-11 (leídos en solo lectura, sin identificadores).
 * `publicado` es la cifra del certificado: la real si existe, si no la
 * estimada.
 */
const CERTIFICADOS: {
  n: number;
  params: ParametrosServicioSolo;
  publicado: number;
}[] = [
  {
    n: 1,
    params: { metodo: 'modelado', distanciaKm: 2.51, cargaKg: 8_000, vehiculo: VEHICULO },
    publicado: 2.691,
  },
  ...(
    [
      [2, 500, 2_000, 'camion_mediano', 385.938],
      [3, 30, 1_500, 'camion_mediano', 23.004],
      [4, 30, 50, 'camion_mediano', 22.562],
      [5, 30, 50, 'camion_mediano', 22.562],
      [6, 464.85, 10_000, 'camion_pesado', 517.437],
      [7, 195.95, 15_000, 'camion_pesado', 224.092],
      [8, 504.72, 20_000, 'camion_pesado', 590.746],
    ] as const
  ).map(([n, distanciaKm, cargaKg, tipoVehiculo, publicado]) => ({
    n,
    params: { metodo: 'por_defecto' as const, distanciaKm, cargaKg, tipoVehiculo },
    publicado,
  })),
];

describe('regresión con los insumos de los 8 certificados emitidos', () => {
  it.each(CERTIFICADOS)(
    'certificado $n: por ruta da exactamente lo mismo que por viaje',
    ({ params }) => {
      expect(calcularHuellaDeServicioSolo('viaje', params).emisiones).toEqual(
        calcularEmisionesViaje(params),
      );
    },
  );

  /**
   * Por qué la cifra publicada no es la de hoy (investigado el 2026-11-11):
   *
   * - 2 a 7 se calcularon antes del 2026-11-02, cuando el factor del diésel
   *   pasó de 3,25 a 3,24 kg CO₂e/L (#872, HC-003). Con 3,25 se reproducen.
   * - 8 se calculó después, con 3,24: se reproduce.
   * - 1 se emitió el 2026-09-14 y el vehículo se editó el 2026-09-28. Con el
   *   factor 3,25 y una capacidad de 10.000 kg (hoy 20.000) calzan la cifra y
   *   los litros guardados; la capacidad anterior no quedó registrada, así que
   *   es la explicación que calza, no un dato.
   *
   * La tolerancia de 6 gramos cubre que la distancia se guarda con 2 decimales.
   */
  const FACTOR_HOY = 3.24;
  const FACTOR_ANTERIOR = 3.25;
  const TOLERANCIA_KG = 0.006;
  const conFactorAnterior = (kg: number) => (kg / FACTOR_HOY) * FACTOR_ANTERIOR;
  const hoy = (params: ParametrosServicioSolo) =>
    calcularHuellaDeServicioSolo('viaje', params).emisiones.emisionesKgco2eWtw;

  it.each(CERTIFICADOS.filter((c) => c.n >= 2 && c.n <= 7))(
    'certificado $n: se reproduce con el factor vigente cuando se emitió (3,25)',
    ({ params, publicado }) => {
      expect(Math.abs(conFactorAnterior(hoy(params)) - publicado)).toBeLessThan(TOLERANCIA_KG);
      // Y no con el de hoy: la diferencia es el cambio de factor, −0,31 %.
      expect(Math.abs(hoy(params) - publicado)).toBeGreaterThan(TOLERANCIA_KG);
    },
  );

  it('certificado 8: se reproduce con el factor de hoy (3,24)', () => {
    const c = CERTIFICADOS.find((x) => x.n === 8);
    expect(Math.abs(hoy(c?.params as ParametrosServicioSolo) - (c?.publicado ?? 0))).toBeLessThan(
      TOLERANCIA_KG,
    );
  });

  it('certificado 1: calza con el factor anterior y la capacidad que tenía el vehículo', () => {
    const c = CERTIFICADOS.find((x) => x.n === 1);
    const entonces = calcularHuellaDeServicioSolo('viaje', {
      metodo: 'modelado',
      distanciaKm: 2.51,
      cargaKg: 8_000,
      vehiculo: { ...VEHICULO, capacidadKg: 10_000 },
    });
    expect(entonces.emisiones.combustibleConsumido).toBe(0.83);
    expect(
      Math.abs(conFactorAnterior(entonces.emisiones.emisionesKgco2eWtw) - (c?.publicado ?? 0)),
    ).toBeLessThan(TOLERANCIA_KG);
    // Con el perfil de hoy no calza.
    expect(
      Math.abs(conFactorAnterior(hoy(c?.params as ParametrosServicioSolo)) - 2.691),
    ).toBeGreaterThan(0.1);
  });
});

// ---------------------------------------------------------------------------
// guardarMetricasDeRuta con una transacción falsa. El comportamiento contra
// PostgreSQL está en test/integration/huella-por-ruta.integration.test.ts.
// ---------------------------------------------------------------------------

type Escritura = { tabla: unknown; valores: Record<string, unknown> };

function txFalsa(rutaId: string | null) {
  const escrituras: Escritura[] = [];
  const consulta = Object.assign(Promise.resolve([{ rutaId }]), {
    from: () => consulta,
    where: () => consulta,
    limit: () => consulta,
  });
  const tx = {
    select: vi.fn(() => consulta),
    insert: vi.fn((tabla: unknown) => ({
      values: vi.fn((valores: Record<string, unknown>) => {
        escrituras.push({ tabla, valores });
        return { onConflictDoUpdate: vi.fn(async () => undefined) };
      }),
    })),
    update: vi.fn((tabla: unknown) => ({
      set: vi.fn((valores: Record<string, unknown>) => {
        escrituras.push({ tabla, valores });
        return { where: vi.fn(async () => undefined) };
      }),
    })),
  };
  return {
    tx: tx as never,
    ruta: () => escrituras.find((e) => e.tabla === metricasRuta)?.valores,
    viaje: () => escrituras.find((e) => e.tabla === tripMetrics)?.valores,
    escrituras,
  };
}

const NIVEL = {
  routeDataSource: 'teltonika_gps',
  coveragePct: 97.5,
  certificationLevel: 'secundario_modeled',
  uncertaintyFactor: 0.08,
} as const;
const HUELLA = calcularHuellaDeServicioSolo('viaje-1', {
  metodo: 'modelado',
  distanciaKm: 350,
  cargaKg: 12_000,
  vehiculo: VEHICULO,
});
/** Diésel medido en litros, sin carga: la intensidad no existe. */
const HUELLA_SIN_CARGA = calcularHuellaDeServicioSolo('viaje-1', {
  metodo: 'modelado',
  distanciaKm: 350,
  cargaKg: 0,
  vehiculo: VEHICULO,
});
/** Eléctrico: el consumo no se mide en litros. */
const HUELLA_ELECTRICA = calcularHuellaDeServicioSolo('viaje-1', {
  metodo: 'modelado',
  distanciaKm: 100,
  cargaKg: 2_000,
  vehiculo: { ...VEHICULO, combustible: 'electrico', consumoBasePor100km: 90 },
});

describe('guardarMetricasDeRuta', () => {
  it('sin ruta en la asignación no escribe nada', async () => {
    const t = txFalsa(null);
    const r = await guardarMetricasDeRuta(t.tx, {
      tripId: 'viaje-1',
      momento: 'estimado',
      huella: HUELLA,
      nivel: NIVEL,
    });
    expect(r).toBeNull();
    expect(t.escrituras).toEqual([]);
  });

  it('estimado: guarda la huella de la ruta y el reparto del viaje', async () => {
    const t = txFalsa('ruta-1');
    const r = await guardarMetricasDeRuta(t.tx, {
      tripId: 'viaje-1',
      momento: 'estimado',
      huella: HUELLA,
      nivel: NIVEL,
    });

    expect(r).toEqual({ rutaId: 'ruta-1' });
    expect(t.ruta()).toMatchObject({
      rutaId: 'ruta-1',
      distanceKmEstimated: '350',
      actividadTkm: '4200',
      carbonEmissionsKgco2eEstimated: HUELLA.ruta.emisionesKgco2eWtw.toString(),
      emisionesKgco2eTtw: HUELLA.ruta.emisionesKgco2eTtw.toString(),
      emisionesKgco2eWtt: HUELLA.ruta.emisionesKgco2eWtt.toString(),
      intensidadGco2ePorTkm: HUELLA.ruta.intensidadGco2ePorTonKm.toString(),
      fuelConsumedLEstimated: HUELLA.ruta.combustibleConsumido.toString(),
      precisionMethod: 'modelado',
      routeDataSource: 'teltonika_gps',
      coveragePct: '97.5',
      certificationLevel: 'secundario_modeled',
      uncertaintyFactor: '0.08',
      versionMetodoReparto: 'tkm-distancia-directa-v1',
    });
    expect(t.ruta()).not.toHaveProperty('carbonEmissionsKgco2eActual');
    expect(t.viaje()).toEqual({
      rutaId: 'ruta-1',
      actividadTkm: '4200',
      participacion: '100',
      versionMetodoReparto: 'tkm-distancia-directa-v1',
    });
  });

  it('estimado sin carga o sin litros: la intensidad y el combustible quedan vacíos', async () => {
    const sinCarga = txFalsa('ruta-1');
    await guardarMetricasDeRuta(sinCarga.tx, {
      tripId: 'viaje-1',
      momento: 'estimado',
      huella: HUELLA_SIN_CARGA,
      nivel: NIVEL,
    });
    expect(sinCarga.ruta()).toMatchObject({ intensidadGco2ePorTkm: null });

    const electrica = txFalsa('ruta-1');
    await guardarMetricasDeRuta(electrica.tx, {
      tripId: 'viaje-1',
      momento: 'estimado',
      huella: HUELLA_ELECTRICA,
      nivel: NIVEL,
    });
    expect(electrica.ruta()).toMatchObject({ fuelConsumedLEstimated: null });
  });

  it('estimado sin huella es un error de quien llama', async () => {
    await expect(
      guardarMetricasDeRuta(txFalsa('ruta-1').tx, {
        tripId: 'viaje-1',
        momento: 'estimado',
        huella: null,
        nivel: NIVEL,
      }),
    ).rejects.toThrow(/siempre tiene huella/);
  });

  it('real con huella: guarda las cifras reales sin tocar las estimadas', async () => {
    const t = txFalsa('ruta-1');
    await guardarMetricasDeRuta(t.tx, {
      tripId: 'viaje-1',
      momento: 'real',
      huella: HUELLA,
      nivel: NIVEL,
      distanciaKmReal: 348.2,
    });

    expect(t.ruta()).toMatchObject({
      distanceKmActual: '348.2',
      carbonEmissionsKgco2eActual: HUELLA.ruta.emisionesKgco2eWtw.toString(),
      fuelConsumedLActual: HUELLA.ruta.combustibleConsumido.toString(),
      emisionesKgco2eTtw: HUELLA.ruta.emisionesKgco2eTtw.toString(),
      intensidadGco2ePorTkm: HUELLA.ruta.intensidadGco2ePorTonKm.toString(),
      actividadTkm: '4200',
      precisionMethod: 'modelado',
    });
    expect(t.ruta()).not.toHaveProperty('carbonEmissionsKgco2eEstimated');
    expect(t.viaje()).toMatchObject({ rutaId: 'ruta-1', participacion: '100' });
  });

  it('real con huella sin carga o sin litros: intensidad y combustible vacíos', async () => {
    const sinCarga = txFalsa('ruta-1');
    await guardarMetricasDeRuta(sinCarga.tx, {
      tripId: 'viaje-1',
      momento: 'real',
      huella: HUELLA_SIN_CARGA,
      nivel: NIVEL,
      distanciaKmReal: 350,
    });
    expect(sinCarga.ruta()).toMatchObject({ intensidadGco2ePorTkm: null });

    const electrica = txFalsa('ruta-1');
    await guardarMetricasDeRuta(electrica.tx, {
      tripId: 'viaje-1',
      momento: 'real',
      huella: HUELLA_ELECTRICA,
      nivel: NIVEL,
      distanciaKmReal: 100,
    });
    expect(electrica.ruta()).toMatchObject({ fuelConsumedLActual: null });
  });

  it('real sin huella: cifras reales y desglose en null, y el viaje solo anota su ruta', async () => {
    const t = txFalsa('ruta-1');
    await guardarMetricasDeRuta(t.tx, {
      tripId: 'viaje-1',
      momento: 'real',
      huella: null,
      nivel: NIVEL,
    });

    expect(t.ruta()).toMatchObject({
      distanceKmActual: null,
      carbonEmissionsKgco2eActual: null,
      fuelConsumedLActual: null,
      emisionesKgco2eTtw: null,
      emisionesKgco2eWtt: null,
      intensidadGco2ePorTkm: null,
      coveragePct: '97.5',
    });
    expect(t.ruta()).not.toHaveProperty('actividadTkm');
    expect(t.viaje()).toEqual({ rutaId: 'ruta-1' });
  });

  it('nivel: solo la distancia real, la fuente, la cobertura y el nivel', async () => {
    const t = txFalsa('ruta-1');
    await guardarMetricasDeRuta(t.tx, {
      tripId: 'viaje-1',
      momento: 'nivel',
      huella: null,
      nivel: NIVEL,
      distanciaKmReal: 120.5,
    });

    const ruta = t.ruta() ?? {};
    expect(Object.keys(ruta).sort()).toEqual(
      [
        'calculatedAt',
        'certificationLevel',
        'coveragePct',
        'distanceKmActual',
        'routeDataSource',
        'rutaId',
        'uncertaintyFactor',
      ].sort(),
    );
    expect(ruta).toMatchObject({ distanceKmActual: '120.5', routeDataSource: 'teltonika_gps' });
  });

  it('nivel sin distancia real: la deja vacía', async () => {
    const t = txFalsa('ruta-1');
    await guardarMetricasDeRuta(t.tx, {
      tripId: 'viaje-1',
      momento: 'nivel',
      huella: null,
      nivel: NIVEL,
    });
    expect(t.ruta()).toMatchObject({ distanceKmActual: null });
  });
});

/**
 * huella-consolidada parte 4: la ruta con varios servicios. La emisión de la
 * ruta se reparte por toneladas-kilómetro de distancia directa (§3.3) y las
 * partes publicadas suman el total (§3.4).
 */
describe('calcularHuellaDeRuta: varios servicios', () => {
  const SERVICIOS = [
    { servicioId: 'viaje-a', masaKg: 8_000, distanciaDirectaKm: 120 },
    { servicioId: 'viaje-b', masaKg: 5_000, distanciaDirectaKm: 60 },
    { servicioId: 'viaje-c', masaKg: 3_000, distanciaDirectaKm: 200 },
  ];
  const TRAMOS = [
    { distanciaKm: 40, cargaKg: 8_000 },
    { distanciaKm: 35, cargaKg: 13_000 },
    { distanciaKm: 50, cargaKg: 16_000 },
    { distanciaKm: 20, cargaKg: 0 },
    { distanciaKm: 90, cargaKg: 3_000 },
  ];
  const suma = (valores: number[]) => Math.round(valores.reduce((a, b) => a + b, 0) * 1000) / 1000;

  it.each([
    ['modelado', { metodo: 'modelado', tramos: TRAMOS, vehiculo: VEHICULO }],
    [
      'combustible medido',
      { metodo: 'exacto_canbus', tramos: TRAMOS, combustibleConsumido: 81.4, vehiculo: VEHICULO },
    ],
    ['por defecto', { metodo: 'por_defecto', tramos: TRAMOS, tipoVehiculo: 'camion_pesado' }],
  ] as const)(
    '%s: las partes suman la huella de la ruta, componente por componente',
    (_n, params) => {
      const { ruta, servicios } = calcularHuellaDeRuta(params, SERVICIOS);
      expect(servicios.map((s) => s.servicioId)).toEqual(['viaje-a', 'viaje-b', 'viaje-c']);
      expect(suma(servicios.map((s) => s.huella.emisiones.emisionesKgco2eWtw))).toBe(
        ruta.emisionesKgco2eWtw,
      );
      expect(suma(servicios.map((s) => s.huella.emisiones.emisionesKgco2eTtw))).toBe(
        ruta.emisionesKgco2eTtw,
      );
      expect(suma(servicios.map((s) => s.huella.emisiones.emisionesKgco2eWtt))).toBe(
        ruta.emisionesKgco2eWtt,
      );
      expect(suma(servicios.map((s) => s.huella.emisiones.combustibleConsumido))).toBe(
        ruta.combustibleConsumido,
      );
      expect(suma(servicios.map((s) => s.huella.reparto.participacionPct))).toBe(100);
      for (const s of servicios) {
        expect(s.huella.ruta).toBe(ruta);
        expect(s.huella.emisiones.metodoPrecision).toBe(ruta.metodoPrecision);
        expect(s.huella.emisiones.factorEmisionUsado).toBe(ruta.factorEmisionUsado);
      }
    },
  );

  it('cada servicio se lleva su proporción de toneladas-kilómetro de distancia directa', () => {
    const { servicios } = calcularHuellaDeRuta(
      { metodo: 'modelado', tramos: TRAMOS, vehiculo: VEHICULO },
      SERVICIOS,
    );
    // a = 960, 300 y 600 tkm sobre 1.860.
    expect(servicios.map((s) => s.huella.reparto.actividadTkm)).toEqual([960, 300, 600]);
    expect(servicios.map((s) => s.huella.reparto.participacionPct)).toEqual([51.61, 16.13, 32.26]);
  });

  it('el servicio publica su distancia directa y la intensidad de su parte', () => {
    const { servicios } = calcularHuellaDeRuta(
      { metodo: 'modelado', tramos: TRAMOS, vehiculo: VEHICULO },
      SERVICIOS,
    );
    for (const [i, s] of servicios.entries()) {
      const esperado = SERVICIOS[i];
      expect(s.huella.emisiones.distanciaKm).toBe(esperado?.distanciaDirectaKm);
      expect(s.huella.emisiones.intensidadGco2ePorTonKm).toBe(
        Math.round(
          ((s.huella.emisiones.emisionesKgco2eWtw * 1000) / s.huella.reparto.actividadTkm) * 100,
        ) / 100,
      );
    }
  });

  it('el resultado no depende del orden en que llegan los servicios', () => {
    const params = { metodo: 'modelado', tramos: TRAMOS, vehiculo: VEHICULO } as const;
    expect(calcularHuellaDeRuta(params, [...SERVICIOS].reverse())).toEqual(
      calcularHuellaDeRuta(params, SERVICIOS),
    );
  });

  it.each(CASOS)('%s: con un servicio es el cálculo del servicio solo (§3.5)', (_n, params) => {
    const tramos = [{ distanciaKm: params.distanciaKm, cargaKg: params.cargaKg }];
    const { metodo: _m, distanciaKm: _d, cargaKg: _c, ...resto } = params;
    const { servicios } = calcularHuellaDeRuta(
      { ...resto, metodo: params.metodo, tramos } as Parameters<typeof calcularHuellaDeRuta>[0],
      [{ servicioId: 'viaje-1', masaKg: params.cargaKg, distanciaDirectaKm: params.distanciaKm }],
    );
    expect(servicios[0]?.huella).toEqual(calcularHuellaDeServicioSolo('viaje-1', params));
  });
});
