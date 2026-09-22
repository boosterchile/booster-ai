import { describe, expect, it } from 'vitest';
import { haversineKm } from '../services/calcular-cobertura-telemetria.js';
import {
  GAP_CORTE_MS,
  KM_MINIMOS_KM_POR_LITRO,
  LITROS_MINIMOS_KM_POR_LITRO,
  NOTA_COBERTURA_PARCIAL,
  NOTA_NIVEL_SUBIO,
  NOTA_SIN_BAJA,
  NOTA_SIN_LECTURA,
  type PuntoSegmentacion,
  UMBRAL_ROBO_BASE_L,
  resumirCombustibleVehiculos,
  segmentarTrayectosTeltonika,
  umbralHormigaLitros,
  umbralRoboLitros,
} from './segmentar-trayectos-teltonika.js';

const VEHICULO = '11111111-1111-4111-8111-111111111111';
const EMPRESA = '22222222-2222-4222-8222-222222222222';
const T0 = Date.parse('2026-09-01T12:00:00.000Z');

function punto(partial: Partial<PuntoSegmentacion> & { tMs: number }): PuntoSegmentacion {
  return {
    vehiculoId: VEHICULO,
    empresaId: EMPRESA,
    patente: 'ABCD12',
    capacidadEstanqueL: null,
    lat: -33.45,
    lng: -70.66,
    speedKmh: 40,
    io: { '239': 1, '240': 1 },
    ...partial,
  };
}

function movimiento(tMs: number, litrosRaw: number): PuntoSegmentacion[] {
  return [
    punto({ tMs, io: { '239': 1, '240': 1, '84': litrosRaw } }),
    punto({
      tMs: tMs + 60_000,
      lat: -33.451,
      io: { '239': 1, '240': 1, '84': litrosRaw },
    }),
  ];
}

function caida(
  tMs: number,
  litrosIniRaw: number,
  litrosFinRaw: number,
  lat: number,
  lng: number,
): PuntoSegmentacion[] {
  return [
    punto({
      tMs,
      lat,
      lng,
      speedKmh: 0,
      io: { '239': 0, '240': 0, '84': litrosIniRaw },
    }),
    punto({
      tMs: tMs + 2 * 60_000,
      lat,
      lng,
      speedKmh: 0,
      io: { '239': 0, '240': 0, '84': litrosFinRaw },
    }),
  ];
}

describe('umbralRoboLitros', () => {
  it('sin capacidad conocida usa 8 L', () => {
    expect(UMBRAL_ROBO_BASE_L).toBe(8);
    expect(umbralRoboLitros(null)).toBe(8);
    expect(umbralRoboLitros(0)).toBe(8);
    expect(umbralRoboLitros(Number.NaN)).toBe(8);
  });

  it('con estanque, U = max(8, 2 % de la capacidad)', () => {
    expect(umbralRoboLitros(300)).toBe(8);
    expect(umbralRoboLitros(500)).toBe(10);
    expect(umbralRoboLitros(1000)).toBe(20);
  });

  it('U_empresa en [5, 20] aplica a la flota y el 2 % sigue de piso', () => {
    expect(umbralRoboLitros(null, 5)).toBe(5);
    expect(umbralRoboLitros(null, 20)).toBe(20);
    expect(umbralRoboLitros(200, 12)).toBe(12);
    expect(umbralRoboLitros(1000, 12)).toBe(20);
    expect(umbralRoboLitros(1000, 5)).toBe(20);
  });

  it('por debajo de 5 L o por encima de 20 L no se usa: vuelve al default', () => {
    expect(umbralRoboLitros(null, 4)).toBe(8);
    expect(umbralRoboLitros(null, 21)).toBe(8);
    expect(umbralRoboLitros(null, Number.NaN)).toBe(8);
  });
});

describe('umbralHormigaLitros', () => {
  it('default 10 L y la config queda en 8–30', () => {
    expect(umbralHormigaLitros(null)).toBe(10);
    expect(umbralHormigaLitros(8)).toBe(8);
    expect(umbralHormigaLitros(30)).toBe(30);
    expect(umbralHormigaLitros(7)).toBe(10);
    expect(umbralHormigaLitros(31)).toBe(10);
  });
});

describe('segmentarTrayectosTeltonika', () => {
  it('ignición 239 + movimiento 240 abren y cierran el trayecto', () => {
    const trayectos = segmentarTrayectosTeltonika([
      punto({ tMs: T0, io: { '239': 1, '240': 1 } }),
      punto({ tMs: T0 + 60_000, lat: -33.46, io: { '239': 1, '240': 1 } }),
      punto({ tMs: T0 + 120_000, speedKmh: 0, io: { '239': 0, '240': 0 } }),
    ]);
    expect(trayectos).toHaveLength(1);
    expect(trayectos[0]).toMatchObject({
      vehiculoId: VEHICULO,
      empresaId: EMPRESA,
      patente: 'ABCD12',
      inicio: new Date(T0).toISOString(),
      fin: new Date(T0 + 60_000).toISOString(),
    });
  });

  it('dos rachas quedan en dos trayectos, el más reciente primero', () => {
    const trayectos = segmentarTrayectosTeltonika([
      punto({ tMs: T0 }),
      punto({ tMs: T0 + 60_000, lat: -33.451 }),
      punto({ tMs: T0 + 120_000, speedKmh: 0, io: { '239': 0, '240': 0 } }),
      punto({ tMs: T0 + 600_000, io: { '239': 1, '240': 1 } }),
      punto({ tMs: T0 + 660_000, lat: -33.452, io: { '239': 1, '240': 1 } }),
    ]);
    expect(trayectos).toHaveLength(2);
    expect(Date.parse(trayectos[0]?.fin ?? '')).toBeGreaterThan(
      Date.parse(trayectos[1]?.fin ?? ''),
    );
  });

  it('DIN1 solo sustituye a 239 cuando 239 no viene en el punto', () => {
    const conDin = segmentarTrayectosTeltonika([
      punto({ tMs: T0, io: { '1': 1, '240': 1 } }),
      punto({ tMs: T0 + 60_000, lat: -33.46, io: { '1': 1, '240': 1 } }),
    ]);
    expect(conDin).toHaveLength(1);

    const ignicionGana = segmentarTrayectosTeltonika([
      punto({ tMs: T0, io: { '239': 0, '1': 1, '240': 1 } }),
      punto({ tMs: T0 + 60_000, io: { '239': 0, '1': 1, '240': 1 } }),
    ]);
    expect(ignicionGana).toHaveLength(0);
  });

  it('IO 250 solo no abre un trayecto', () => {
    const trayectos = segmentarTrayectosTeltonika([
      punto({ tMs: T0, speedKmh: 0, io: { '250': 1 } }),
      punto({ tMs: T0 + 60_000, speedKmh: 0, io: { '250': 0 } }),
    ]);
    expect(trayectos).toHaveLength(0);
  });

  it('IO 250 estira el borde si cae a menos de 2 min del trayecto real', () => {
    const trayectos = segmentarTrayectosTeltonika([
      punto({ tMs: T0, speedKmh: 0, io: { '239': 0, '240': 0, '250': 1 } }),
      punto({ tMs: T0 + 60_000, io: { '239': 1, '240': 1 } }),
      punto({ tMs: T0 + 120_000, lat: -33.46, io: { '239': 1, '240': 1 } }),
      punto({
        tMs: T0 + 150_000,
        speedKmh: 0,
        io: { '239': 0, '240': 0, '250': 0 },
      }),
    ]);
    expect(trayectos).toHaveLength(1);
    expect(trayectos[0]?.inicio).toBe(new Date(T0).toISOString());
    expect(trayectos[0]?.fin).toBe(new Date(T0 + 150_000).toISOString());
  });

  it('un hueco mayor a 15 min corta el trayecto', () => {
    const trayectos = segmentarTrayectosTeltonika([
      punto({ tMs: T0 }),
      punto({ tMs: T0 + 60_000, lat: -33.451 }),
      punto({ tMs: T0 + 60_000 + GAP_CORTE_MS + 1_000 }),
      punto({ tMs: T0 + 60_000 + GAP_CORTE_MS + 61_000, lat: -33.452 }),
    ]);
    expect(trayectos).toHaveLength(2);
  });

  it('sin ignición conocida no inventa un trayecto aunque haya velocidad', () => {
    const trayectos = segmentarTrayectosTeltonika([
      punto({ tMs: T0, io: {} }),
      punto({ tMs: T0 + 60_000, lat: -33.46, io: {} }),
    ]);
    expect(trayectos).toHaveLength(0);
  });

  it('ignición on y velocidad GPS > 5 km/h alcanzan aunque no venga el 240', () => {
    const trayectos = segmentarTrayectosTeltonika([
      punto({ tMs: T0, speedKmh: 30, io: { '239': 1 } }),
      punto({ tMs: T0 + 60_000, lat: -33.46, speedKmh: 30, io: { '239': 1 } }),
    ]);
    expect(trayectos).toHaveLength(1);
    expect(trayectos[0]?.distanciaKm).toBeGreaterThan(0);
  });

  it('no suma distancia por el null island 0,0', () => {
    const trayectos = segmentarTrayectosTeltonika([
      punto({ tMs: T0, lat: -33.45, lng: -70.66 }),
      punto({ tMs: T0 + 30_000, lat: 0, lng: 0 }),
      punto({ tMs: T0 + 60_000, lat: -33.46, lng: -70.66 }),
    ]);
    const esperado = haversineKm(-33.45, -70.66, -33.46, -70.66);
    expect(trayectos[0]?.distanciaKm).toBeCloseTo(esperado, 2);
  });

  it('con litros válidos y ΔL > 0 calcula km/L = distancia / (L ini − L fin)', () => {
    const trayectos = segmentarTrayectosTeltonika([
      punto({ tMs: T0, io: { '239': 1, '240': 1, '84': 1000 } }),
      punto({
        tMs: T0 + 60_000,
        lat: -33.55,
        io: { '239': 1, '240': 1, '84': 800 },
      }),
    ]);
    const dist = haversineKm(-33.45, -70.66, -33.55, -70.66);
    expect(trayectos[0]).toMatchObject({
      litrosIniciales: 100,
      litrosFinales: 80,
      sensorCombustible: 'presente',
      ctaSensor: false,
      notaCombustible: null,
    });
    expect(trayectos[0]?.kmPorLitro).toBeCloseTo(dist / 20, 2);
  });

  it('si el nivel no baja, km/L es null y hay nota', () => {
    const plano = segmentarTrayectosTeltonika([
      punto({ tMs: T0, io: { '239': 1, '240': 1, '84': 500 } }),
      punto({ tMs: T0 + 60_000, lat: -33.46, io: { '239': 1, '240': 1, '84': 500 } }),
    ]);
    expect(plano[0]?.kmPorLitro).toBeNull();
    expect(plano[0]?.notaCombustible).toBe(NOTA_SIN_BAJA);

    const sube = segmentarTrayectosTeltonika([
      punto({ tMs: T0, io: { '239': 1, '240': 1, '84': 400 } }),
      punto({ tMs: T0 + 60_000, lat: -33.46, io: { '239': 1, '240': 1, '84': 700 } }),
    ]);
    expect(sube[0]?.kmPorLitro).toBeNull();
    expect(sube[0]?.notaCombustible).toBe(NOTA_NIVEL_SUBIO);
    expect(sube[0]?.posibleRoboCombustible).toBe(false);
  });

  it('sin ninguna clave de combustible: trayecto y km, sin litros ni badge, con CTA', () => {
    const trayectos = segmentarTrayectosTeltonika([
      punto({ tMs: T0 }),
      punto({ tMs: T0 + 60_000, lat: -33.46 }),
    ]);
    expect(trayectos[0]).toMatchObject({
      litrosIniciales: null,
      litrosFinales: null,
      kmPorLitro: null,
      posibleRoboCombustible: false,
      sensorCombustible: 'ausente',
      ctaSensor: true,
      notaCombustible: null,
    });
    expect(trayectos[0]?.distanciaKm).toBeGreaterThan(0);
  });

  it('84 fuera de rango no inventa litros ni badge', () => {
    const trayectos = segmentarTrayectosTeltonika([
      punto({ tMs: T0, io: { '239': 1, '240': 1, '84': 99_999 } }),
      punto({
        tMs: T0 + 60_000,
        lat: -33.46,
        io: { '239': 1, '240': 1, '84': 99_999 },
      }),
    ]);
    expect(trayectos[0]).toMatchObject({
      litrosIniciales: null,
      litrosFinales: null,
      kmPorLitro: null,
      posibleRoboCombustible: false,
      sensorCombustible: 'degradado',
      ctaSensor: false,
      notaCombustible: NOTA_SIN_LECTURA,
    });
  });

  it('solo el porcentaje 89 muestra el nivel en % y no lo convierte a litros', () => {
    const trayectos = segmentarTrayectosTeltonika([
      punto({ tMs: T0, io: { '239': 1, '240': 1, '89': 80 } }),
      punto({ tMs: T0 + 60_000, lat: -33.46, io: { '239': 1, '240': 1, '89': 40 } }),
    ]);
    expect(trayectos[0]).toMatchObject({
      fuenteCombustible: 'nivel_porcentaje',
      nivelPctInicial: 80,
      nivelPctFinal: 40,
      litrosIniciales: null,
      litrosFinales: null,
      litrosConsumidos: null,
      kmPorLitro: null,
      posibleRoboCombustible: false,
      sensorCombustible: 'degradado',
      notaCombustible: null,
    });
  });

  it('un trayecto sin 84 válido no hereda litros de otro trayecto del mismo vehículo', () => {
    const trayectos = segmentarTrayectosTeltonika([
      punto({ tMs: T0, io: { '239': 1, '240': 1, '84': 500 } }),
      punto({ tMs: T0 + 60_000, lat: -33.46, io: { '239': 1, '240': 1, '84': 480 } }),
      punto({ tMs: T0 + 120_000, speedKmh: 0, io: { '239': 0, '240': 0 } }),
      punto({ tMs: T0 + 600_000, io: { '239': 1, '240': 1 } }),
      punto({ tMs: T0 + 660_000, lat: -33.47, io: { '239': 1, '240': 1 } }),
    ]);
    const sinLitros = trayectos.find((t) => t.inicio === new Date(T0 + 600_000).toISOString());
    expect(sinLitros).toMatchObject({
      litrosIniciales: null,
      litrosFinales: null,
      kmPorLitro: null,
      posibleRoboCombustible: false,
      sensorCombustible: 'presente',
      notaCombustible: NOTA_SIN_LECTURA,
    });
  });

  it('si el fin del trayecto solapa la caída, el badge queda en ese trayecto', () => {
    const trayectos = segmentarTrayectosTeltonika([
      punto({ tMs: T0, io: { '239': 1, '240': 1, '84': 800 } }),
      punto({ tMs: T0 + 60_000, lat: -33.46, io: { '239': 1, '240': 1, '84': 790 } }),
      punto({
        tMs: T0 + 90_000,
        speedKmh: 0,
        io: { '239': 0, '240': 0, '84': 790, '250': 0 },
      }),
      punto({
        tMs: T0 + 120_000,
        speedKmh: 0,
        io: { '239': 0, '240': 0, '84': 590 },
      }),
      punto({ tMs: T0 + 30 * 60_000, io: { '239': 1, '240': 1, '84': 400 } }),
      punto({
        tMs: T0 + 31 * 60_000,
        lat: -33.47,
        io: { '239': 1, '240': 1, '84': 390 },
      }),
    ]);
    const marcado = trayectos.find((t) => t.posibleRoboCombustible);
    expect(marcado?.inicio).toBe(new Date(T0).toISOString());
    expect(trayectos.filter((t) => t.posibleRoboCombustible)).toHaveLength(1);
  });

  it('marca posible robo si caen ≥ U litros en ≤ 5 min, detenido y sin ignición', () => {
    const trayectos = segmentarTrayectosTeltonika([
      punto({ tMs: T0, io: { '239': 1, '240': 1, '84': 800 } }),
      punto({ tMs: T0 + 60_000, lat: -33.46, io: { '239': 1, '240': 1, '84': 790 } }),
      punto({
        tMs: T0 + 10 * 60_000,
        speedKmh: 0,
        io: { '239': 0, '240': 0, '84': 790 },
      }),
      punto({
        tMs: T0 + 12 * 60_000,
        speedKmh: 0,
        io: { '239': 0, '240': 0, '84': 590 },
      }),
    ]);
    expect(trayectos).toHaveLength(1);
    expect(trayectos[0]?.posibleRoboCombustible).toBe(true);
    expect(trayectos[0]?.litrosIniciales).toBe(80);
    expect(trayectos[0]?.litrosFinales).toBe(79);
  });

  it('marca robo con ignición encendida si el vehículo está detenido', () => {
    const trayectos = segmentarTrayectosTeltonika([
      punto({ tMs: T0, io: { '239': 1, '240': 1, '84': 200 } }),
      punto({ tMs: T0 + 30_000, lat: -33.451, io: { '239': 1, '240': 1, '84': 200 } }),
      punto({ tMs: T0 + 90_000, speedKmh: 5, io: { '239': 1, '240': 0, '84': 800 } }),
      punto({ tMs: T0 + 120_000, speedKmh: 5, io: { '239': 1, '240': 0, '84': 500 } }),
    ]);
    expect(trayectos).toHaveLength(1);
    expect(trayectos[0]?.posibleRoboCombustible).toBe(true);
  });

  it('un lote bufferizado marca por timestamp de dispositivo aunque llegue desordenado', () => {
    const trayectos = segmentarTrayectosTeltonika([
      punto({
        tMs: T0 + 12 * 60_000,
        speedKmh: 0,
        io: { '239': 1, '240': 0, '84': 500 },
      }),
      punto({ tMs: T0, io: { '239': 1, '240': 1, '84': 800 } }),
      punto({
        tMs: T0 + 10 * 60_000,
        speedKmh: 0,
        io: { '239': 1, '240': 0, '84': 800 },
      }),
      punto({ tMs: T0 + 60_000, lat: -33.46, io: { '239': 1, '240': 1, '84': 800 } }),
    ]);
    expect(trayectos[0]?.posibleRoboCombustible).toBe(true);
  });

  it('no marca robo si la caída es en marcha o demora más de 5 min', () => {
    const enMarcha = segmentarTrayectosTeltonika([
      punto({ tMs: T0, speedKmh: 40, io: { '239': 1, '240': 1, '84': 800 } }),
      punto({
        tMs: T0 + 60_000,
        lat: -33.46,
        speedKmh: 40,
        io: { '239': 1, '240': 1, '84': 500 },
      }),
    ]);
    expect(enMarcha[0]?.posibleRoboCombustible).toBe(false);

    const lento = segmentarTrayectosTeltonika([
      punto({ tMs: T0, io: { '239': 1, '240': 1, '84': 200 } }),
      punto({ tMs: T0 + 30_000, lat: -33.451, io: { '239': 1, '240': 1, '84': 200 } }),
      punto({
        tMs: T0 + 10 * 60_000,
        speedKmh: 0,
        io: { '239': 0, '240': 0, '84': 800 },
      }),
      punto({
        tMs: T0 + 16 * 60_000,
        speedKmh: 0,
        io: { '239': 0, '240': 0, '84': 500 },
      }),
    ]);
    expect(lento[0]?.posibleRoboCombustible).toBe(false);
  });

  it('con estanque de 1000 L el umbral sube al 2 % (20 L)', () => {
    const base = {
      capacidadEstanqueL: 1000,
    };
    const corto = segmentarTrayectosTeltonika([
      punto({ ...base, tMs: T0, io: { '239': 1, '240': 1, '84': 200 } }),
      punto({
        ...base,
        tMs: T0 + 30_000,
        lat: -33.451,
        io: { '239': 1, '240': 1, '84': 200 },
      }),
      punto({
        ...base,
        tMs: T0 + 10 * 60_000,
        speedKmh: 0,
        io: { '239': 0, '240': 0, '84': 800 },
      }),
      punto({
        ...base,
        tMs: T0 + 12 * 60_000,
        speedKmh: 0,
        io: { '239': 0, '240': 0, '84': 610 },
      }),
    ]);
    expect(corto[0]?.posibleRoboCombustible).toBe(false);

    const suficiente = segmentarTrayectosTeltonika([
      punto({ ...base, tMs: T0, io: { '239': 1, '240': 1, '84': 200 } }),
      punto({
        ...base,
        tMs: T0 + 30_000,
        lat: -33.451,
        io: { '239': 1, '240': 1, '84': 200 },
      }),
      punto({
        ...base,
        tMs: T0 + 10 * 60_000,
        speedKmh: 0,
        io: { '239': 0, '240': 0, '84': 800 },
      }),
      punto({
        ...base,
        tMs: T0 + 12 * 60_000,
        speedKmh: 0,
        io: { '239': 0, '240': 0, '84': 600 },
      }),
    ]);
    expect(suficiente[0]?.posibleRoboCombustible).toBe(true);
  });

  it('una caída de menos de 8 L no marca robo si no hay capacidad', () => {
    const trayectos = segmentarTrayectosTeltonika([
      punto({ tMs: T0, io: { '239': 1, '240': 1, '84': 200 } }),
      punto({ tMs: T0 + 30_000, lat: -33.451, io: { '239': 1, '240': 1, '84': 200 } }),
      punto({
        tMs: T0 + 10 * 60_000,
        speedKmh: 0,
        io: { '239': 0, '240': 0, '84': 500 },
      }),
      punto({
        tMs: T0 + 12 * 60_000,
        speedKmh: 0,
        io: { '239': 0, '240': 0, '84': 430 },
      }),
    ]);
    expect(trayectos[0]?.posibleRoboCombustible).toBe(false);
  });

  it('una caída de 8 L exactos marca el golpe único', () => {
    const trayectos = segmentarTrayectosTeltonika([
      punto({ tMs: T0, io: { '239': 1, '240': 1, '84': 200 } }),
      punto({ tMs: T0 + 30_000, lat: -33.451, io: { '239': 1, '240': 1, '84': 200 } }),
      punto({
        tMs: T0 + 10 * 60_000,
        speedKmh: 0,
        io: { '239': 0, '240': 0, '84': 500 },
      }),
      punto({
        tMs: T0 + 12 * 60_000,
        speedKmh: 0,
        io: { '239': 0, '240': 0, '84': 420 },
      }),
    ]);
    expect(trayectos[0]?.posibleRoboCombustible).toBe(true);
  });

  it('sin badge no expone coordenadas del evento', () => {
    const trayectos = segmentarTrayectosTeltonika([
      punto({ tMs: T0, lat: -33.45, lng: -70.66 }),
      punto({ tMs: T0 + 60_000, lat: -33.46, lng: -70.67 }),
    ]);
    expect(trayectos[0]).toMatchObject({
      posibleRoboCombustible: false,
      eventLat: null,
      eventLon: null,
    });
  });

  it('el pin es el inicio de la ventana de caída, por timestamp de dispositivo', () => {
    const trayectos = segmentarTrayectosTeltonika([
      punto({
        tMs: T0 + 12 * 60_000,
        lat: -33.48,
        lng: -70.7,
        speedKmh: 0,
        io: { '239': 0, '240': 0, '84': 590 },
      }),
      punto({ tMs: T0, lat: -33.45, lng: -70.66, io: { '239': 1, '240': 1, '84': 800 } }),
      punto({
        tMs: T0 + 10 * 60_000,
        lat: -33.4,
        lng: -70.6,
        speedKmh: 0,
        io: { '239': 0, '240': 0, '84': 800 },
      }),
      punto({
        tMs: T0 + 60_000,
        lat: -33.451,
        lng: -70.66,
        io: { '239': 1, '240': 1, '84': 790 },
      }),
    ]);
    expect(trayectos[0]).toMatchObject({
      posibleRoboCombustible: true,
      eventLat: -33.4,
      eventLon: -70.6,
    });
  });

  it('si el inicio de la ventana no tiene fix, usa el primer punto válido dentro de ella', () => {
    const trayectos = segmentarTrayectosTeltonika([
      punto({ tMs: T0, io: { '239': 1, '240': 1, '84': 800 } }),
      punto({ tMs: T0 + 60_000, lat: -33.451, io: { '239': 1, '240': 1, '84': 790 } }),
      punto({
        tMs: T0 + 10 * 60_000,
        lat: null,
        lng: null,
        speedKmh: 0,
        io: { '239': 0, '240': 0, '84': 800 },
      }),
      punto({
        tMs: T0 + 11 * 60_000,
        lat: -33.41,
        lng: -70.61,
        speedKmh: 0,
        io: { '239': 0, '240': 0, '84': 700 },
      }),
      punto({
        tMs: T0 + 12 * 60_000,
        lat: -33.49,
        lng: -70.71,
        speedKmh: 0,
        io: { '239': 0, '240': 0, '84': 590 },
      }),
    ]);
    expect(trayectos[0]).toMatchObject({
      posibleRoboCombustible: true,
      eventLat: -33.41,
      eventLon: -70.61,
    });
  });

  it('no inventa pin con el trayecto, el null island ni un punto fuera de la ventana', () => {
    const trayectos = segmentarTrayectosTeltonika([
      punto({ tMs: T0, lat: -33.45, lng: -70.66, io: { '239': 1, '240': 1, '84': 800 } }),
      punto({
        tMs: T0 + 60_000,
        lat: -33.451,
        lng: -70.66,
        io: { '239': 1, '240': 1, '84': 790 },
      }),
      punto({
        tMs: T0 + 10 * 60_000,
        lat: 0,
        lng: 0,
        speedKmh: 0,
        io: { '239': 0, '240': 0, '84': 800 },
      }),
      punto({
        tMs: T0 + 12 * 60_000,
        lat: null,
        lng: null,
        speedKmh: 0,
        io: { '239': 0, '240': 0, '84': 590 },
      }),
      punto({
        tMs: T0 + 16 * 60_000,
        lat: -33.7,
        lng: -70.8,
        speedKmh: 0,
        io: { '239': 0, '240': 0, '84': 590 },
      }),
    ]);
    expect(trayectos[0]).toMatchObject({
      posibleRoboCombustible: true,
      eventLat: null,
      eventLon: null,
    });
  });

  it('si la primera ventana no tiene fix, el pin sale de la siguiente caída que sí lo tiene', () => {
    const trayectos = segmentarTrayectosTeltonika([
      punto({ tMs: T0, io: { '239': 1, '240': 1, '84': 800 } }),
      punto({ tMs: T0 + 60_000, lat: -33.451, io: { '239': 1, '240': 1, '84': 790 } }),
      punto({
        tMs: T0 + 10 * 60_000,
        lat: null,
        lng: null,
        speedKmh: 0,
        io: { '239': 0, '240': 0, '84': 800 },
      }),
      punto({
        tMs: T0 + 12 * 60_000,
        lat: null,
        lng: null,
        speedKmh: 0,
        io: { '239': 0, '240': 0, '84': 600 },
      }),
      punto({
        tMs: T0 + 13 * 60_000,
        lat: -33.42,
        lng: -70.62,
        speedKmh: 0,
        io: { '239': 0, '240': 0, '84': 600 },
      }),
      punto({
        tMs: T0 + 14 * 60_000,
        lat: -33.49,
        lng: -70.69,
        speedKmh: 0,
        io: { '239': 0, '240': 0, '84': 400 },
      }),
    ]);
    expect(trayectos[0]).toMatchObject({
      posibleRoboCombustible: true,
      eventLat: -33.42,
      eventLon: -70.62,
    });
  });

  it('dos caídas chicas en el mismo trayecto marcan hormiga y no el golpe', () => {
    const trayectos = segmentarTrayectosTeltonika([
      ...movimiento(T0, 1000),
      ...caida(T0 + 10 * 60_000, 1000, 940, -33.41, -70.61),
      ...caida(T0 + 24 * 60_000, 940, 900, -33.49, -70.69),
    ]);
    expect(trayectos).toHaveLength(1);
    expect(trayectos[0]).toMatchObject({
      posibleRoboCombustible: false,
      posibleRoboHormiga: true,
      eventLat: -33.41,
      eventLon: -70.61,
    });
  });

  it('un solo episodio por debajo del golpe no es hormiga', () => {
    const trayectos = segmentarTrayectosTeltonika([
      ...movimiento(T0, 1000),
      ...caida(T0 + 10 * 60_000, 1000, 940, -33.41, -70.61),
    ]);
    expect(trayectos[0]).toMatchObject({
      posibleRoboCombustible: false,
      posibleRoboHormiga: false,
      eventLat: null,
      eventLon: null,
    });
  });

  it('una baja de menos de 2 L o con el vehículo en marcha no cuenta como episodio', () => {
    const ruidoLitros = segmentarTrayectosTeltonika(
      [
        ...movimiento(T0, 1000),
        ...caida(T0 + 10 * 60_000, 1000, 930, -33.41, -70.61),
        ...caida(T0 + 30 * 60_000, 930, 911, -33.42, -70.62),
      ],
      { uGolpeL: null, uHormigaL: 8 },
    );
    expect(ruidoLitros[0]).toMatchObject({
      posibleRoboCombustible: false,
      posibleRoboHormiga: false,
    });

    const ruidoVelocidad = segmentarTrayectosTeltonika([
      ...movimiento(T0, 1000),
      ...caida(T0 + 10 * 60_000, 1000, 940, -33.41, -70.61),
      punto({
        tMs: T0 + 30 * 60_000,
        speedKmh: 40,
        io: { '239': 1, '240': 1, '84': 940 },
      }),
      punto({
        tMs: T0 + 32 * 60_000,
        lat: -33.42,
        lng: -70.62,
        speedKmh: 40,
        io: { '239': 1, '240': 1, '84': 900 },
      }),
    ]);
    expect(ruidoVelocidad[0]).toMatchObject({
      posibleRoboCombustible: false,
      posibleRoboHormiga: false,
    });
  });

  it('un episodio de 6 L y otro de 2 L suman hormiga si el umbral de la empresa es 8', () => {
    const trayectos = segmentarTrayectosTeltonika(
      [
        ...movimiento(T0, 1000),
        ...caida(T0 + 10 * 60_000, 1000, 940, -33.41, -70.61),
        ...caida(T0 + 30 * 60_000, 940, 920, -33.42, -70.62),
      ],
      { uGolpeL: null, uHormigaL: 8 },
    );
    expect(trayectos[0]).toMatchObject({
      posibleRoboCombustible: false,
      posibleRoboHormiga: true,
    });
  });

  it('fines a menos de 10 min son un solo episodio', () => {
    const trayectos = segmentarTrayectosTeltonika([
      ...movimiento(T0, 1000),
      ...caida(T0 + 10 * 60_000, 1000, 940, -33.41, -70.61),
      ...caida(T0 + 19 * 60_000, 940, 880, -33.42, -70.62),
    ]);
    expect(trayectos[0]).toMatchObject({
      posibleRoboCombustible: false,
      posibleRoboHormiga: false,
    });
  });

  it('no junta episodios de dos trayectos distintos', () => {
    const trayectos = segmentarTrayectosTeltonika([
      ...movimiento(T0, 1000),
      ...caida(T0 + 10 * 60_000, 1000, 940, -33.41, -70.61),
      ...movimiento(T0 + 40 * 60_000, 940),
      ...caida(T0 + 55 * 60_000, 940, 880, -33.43, -70.63),
    ]);
    expect(trayectos).toHaveLength(2);
    expect(trayectos.every((t) => t.posibleRoboHormiga === false)).toBe(true);
    expect(trayectos.every((t) => t.posibleRoboCombustible === false)).toBe(true);
  });

  it('en un trayecto largo la ventana de hormiga es de 6 h', () => {
    const lejos = segmentarTrayectosTeltonika([
      ...movimiento(T0, 1000),
      ...caida(T0 + 10 * 60_000, 1000, 940, -33.41, -70.61),
      ...caida(T0 + 10 * 60_000 + 7 * 60 * 60_000, 940, 880, -33.44, -70.64),
    ]);
    expect(lejos[0]?.posibleRoboHormiga).toBe(false);

    const dentro = segmentarTrayectosTeltonika([
      ...movimiento(T0, 1000),
      ...caida(T0 + 10 * 60_000, 1000, 940, -33.41, -70.61),
      ...caida(T0 + 10 * 60_000 + 5 * 60 * 60_000, 940, 880, -33.44, -70.64),
    ]);
    expect(dentro[0]).toMatchObject({
      posibleRoboHormiga: true,
      posibleRoboCombustible: false,
      eventLat: -33.41,
      eventLon: -70.61,
    });
  });

  it('si hay golpe y hormiga, el pin sigue siendo el de la caída del golpe', () => {
    const trayectos = segmentarTrayectosTeltonika([
      ...movimiento(T0, 1000),
      ...caida(T0 + 10 * 60_000, 1000, 900, -33.41, -70.61),
      ...caida(T0 + 30 * 60_000, 900, 800, -33.48, -70.68),
    ]);
    expect(trayectos[0]).toMatchObject({
      posibleRoboCombustible: true,
      posibleRoboHormiga: true,
      eventLat: -33.41,
      eventLon: -70.61,
    });
  });

  it('U_empresa de 5 L marca un golpe de 5 L en todos los puntos de la empresa', () => {
    const trayectos = segmentarTrayectosTeltonika(
      [...movimiento(T0, 500), ...caida(T0 + 10 * 60_000, 500, 450, -33.41, -70.61)],
      { uGolpeL: 5, uHormigaL: null },
    );
    expect(trayectos[0]).toMatchObject({
      posibleRoboCombustible: true,
      posibleRoboHormiga: false,
      eventLat: -33.41,
      eventLon: -70.61,
    });
  });

  it('no mezcla el arrastre de ignición entre dos vehículos', () => {
    const otro = '33333333-3333-4333-8333-333333333333';
    const trayectos = segmentarTrayectosTeltonika([
      punto({ tMs: T0, io: { '239': 1, '240': 1 } }),
      punto({ tMs: T0 + 60_000, lat: -33.46, io: { '239': 1, '240': 1 } }),
      punto({
        tMs: T0,
        vehiculoId: otro,
        patente: 'ZZZZ99',
        speedKmh: 40,
        io: { '240': 1 },
      }),
      punto({
        tMs: T0 + 60_000,
        vehiculoId: otro,
        patente: 'ZZZZ99',
        lat: -33.47,
        speedKmh: 40,
        io: { '240': 1 },
      }),
    ]);
    expect(trayectos).toHaveLength(1);
    expect(trayectos[0]?.vehiculoId).toBe(VEHICULO);
  });
});

describe('fuentes de combustible CAN (slice 2026-09-22)', () => {
  // ~11,1 km: por encima del mínimo de 10 km para calcular km/L.
  const distancia = haversineKm(-33.45, -70.66, -33.55, -70.66);

  it('sin 84, el Δ del contador 83 da litros consumidos y km/L; L ini y L fin quedan null', () => {
    const trayectos = segmentarTrayectosTeltonika([
      punto({ tMs: T0, io: { '239': 1, '240': 1, '83': 581_520, '89': 60 } }),
      punto({
        tMs: T0 + 60_000,
        lat: -33.55,
        io: { '239': 1, '240': 1, '83': 581_570, '89': 58 },
      }),
    ]);
    expect(trayectos[0]).toMatchObject({
      fuenteCombustible: 'consumo_can',
      litrosConsumidos: 5,
      litrosIniciales: null,
      litrosFinales: null,
      nivelPctInicial: 60,
      nivelPctFinal: 58,
      notaCombustible: null,
      sensorCombustible: 'degradado',
      posibleRoboCombustible: false,
      posibleRoboHormiga: false,
      ctaSensor: false,
    });
    expect(trayectos[0]?.kmPorLitro).toBeCloseTo(distancia / 5, 2);
  });

  it('con menos de 5 L o de 10 km no calcula litros ni km/L, y no pone nota por fila', () => {
    expect(LITROS_MINIMOS_KM_POR_LITRO).toBe(5);
    expect(KM_MINIMOS_KM_POR_LITRO).toBe(10);
    const sinSubir = segmentarTrayectosTeltonika([
      punto({ tMs: T0, io: { '239': 1, '240': 1, '83': 581_520 } }),
      punto({ tMs: T0 + 60_000, lat: -33.55, io: { '239': 1, '240': 1, '83': 581_520 } }),
    ]);
    const pocosLitros = segmentarTrayectosTeltonika([
      punto({ tMs: T0, io: { '239': 1, '240': 1, '83': 581_520 } }),
      punto({ tMs: T0 + 60_000, lat: -33.55, io: { '239': 1, '240': 1, '83': 581_560 } }),
    ]);
    const pocosKm = segmentarTrayectosTeltonika([
      punto({ tMs: T0, io: { '239': 1, '240': 1, '83': 581_520 } }),
      punto({ tMs: T0 + 60_000, lat: -33.46, io: { '239': 1, '240': 1, '83': 581_620 } }),
    ]);
    const nivelChico = segmentarTrayectosTeltonika([
      punto({ tMs: T0, io: { '239': 1, '240': 1, '84': 1000 } }),
      punto({ tMs: T0 + 60_000, lat: -33.55, io: { '239': 1, '240': 1, '84': 980 } }),
    ]);
    for (const [trayecto, fuente] of [
      [sinSubir[0], 'consumo_can'],
      [pocosLitros[0], 'consumo_can'],
      [pocosKm[0], 'consumo_can'],
      [nivelChico[0], 'nivel_litros'],
    ] as const) {
      expect(trayecto).toMatchObject({
        fuenteCombustible: fuente,
        litrosConsumidos: null,
        kmPorLitro: null,
        notaCombustible: null,
      });
    }
    expect(nivelChico[0]).toMatchObject({ litrosIniciales: 100, litrosFinales: 98 });
  });

  it('una sola lectura del 83, sin 89, no alcanza: el trayecto queda sin dato', () => {
    const trayectos = segmentarTrayectosTeltonika([
      punto({ tMs: T0, io: { '239': 1, '240': 1, '83': 581_520 } }),
      punto({ tMs: T0 + 60_000, lat: -33.46, io: { '239': 1, '240': 1 } }),
    ]);
    expect(trayectos[0]).toMatchObject({
      fuenteCombustible: null,
      litrosConsumidos: null,
      kmPorLitro: null,
      notaCombustible: NOTA_SIN_LECTURA,
    });
  });

  it('si el trayecto trae 84, el nivel en litros manda aunque venga el 83', () => {
    const trayectos = segmentarTrayectosTeltonika([
      punto({ tMs: T0, io: { '239': 1, '240': 1, '84': 1000, '83': 100 } }),
      punto({ tMs: T0 + 60_000, lat: -33.55, io: { '239': 1, '240': 1, '84': 800, '83': 400 } }),
    ]);
    expect(trayectos[0]).toMatchObject({
      fuenteCombustible: 'nivel_litros',
      litrosIniciales: 100,
      litrosFinales: 80,
      litrosConsumidos: 20,
      sensorCombustible: 'presente',
    });
    expect(trayectos[0]?.kmPorLitro).toBeCloseTo(distancia / 20, 2);
  });

  it('si la lectura cubre menos del 90 % de la distancia, no calcula litros ni km/L', () => {
    const consumo = segmentarTrayectosTeltonika([
      punto({ tMs: T0, io: { '239': 1, '240': 1, '83': 100 } }),
      punto({ tMs: T0 + 60_000, lat: -33.46, io: { '239': 1, '240': 1, '83': 250 } }),
      punto({ tMs: T0 + 120_000, lat: -33.6, io: { '239': 1, '240': 1 } }),
    ]);
    expect(consumo[0]).toMatchObject({
      fuenteCombustible: 'consumo_can',
      litrosConsumidos: null,
      kmPorLitro: null,
      notaCombustible: NOTA_COBERTURA_PARCIAL,
    });

    const nivel = segmentarTrayectosTeltonika([
      punto({ tMs: T0, io: { '239': 1, '240': 1, '84': 1000 } }),
      punto({ tMs: T0 + 60_000, lat: -33.46, io: { '239': 1, '240': 1, '84': 900 } }),
      punto({ tMs: T0 + 120_000, lat: -33.6, io: { '239': 1, '240': 1 } }),
    ]);
    expect(nivel[0]).toMatchObject({
      fuenteCombustible: 'nivel_litros',
      litrosIniciales: 100,
      litrosFinales: 90,
      litrosConsumidos: null,
      kmPorLitro: null,
      notaCombustible: NOTA_COBERTURA_PARCIAL,
    });
  });

  it('con cobertura ≥ 90 %, el km/L usa la distancia del tramo leído', () => {
    const trayectos = segmentarTrayectosTeltonika([
      punto({ tMs: T0, io: { '239': 1, '240': 1, '83': 100 } }),
      punto({ tMs: T0 + 60_000, lat: -33.55, io: { '239': 1, '240': 1, '83': 200 } }),
      punto({ tMs: T0 + 120_000, lat: -33.555, io: { '239': 1, '240': 1 } }),
    ]);
    expect(trayectos[0]?.litrosConsumidos).toBe(10);
    expect(trayectos[0]?.kmPorLitro).toBeCloseTo(distancia / 10, 2);
    expect(trayectos[0]?.distanciaKm).toBeGreaterThan(distancia);
  });

  it('sin ninguna clave de combustible el trayecto no tiene fuente', () => {
    const trayectos = segmentarTrayectosTeltonika([
      punto({ tMs: T0 }),
      punto({ tMs: T0 + 60_000, lat: -33.46 }),
    ]);
    expect(trayectos[0]).toMatchObject({
      fuenteCombustible: null,
      litrosConsumidos: null,
      nivelPctInicial: null,
      nivelPctFinal: null,
    });
  });

  it('con el 239 en 0 y RPM CAN > 0 el motor gira: abre el trayecto', () => {
    const trayectos = segmentarTrayectosTeltonika([
      punto({ tMs: T0, io: { '239': 0, '240': 1, '85': 1200 } }),
      punto({ tMs: T0 + 60_000, lat: -33.46, io: { '239': 0, '240': 1, '85': 1300 } }),
      punto({ tMs: T0 + 120_000, speedKmh: 0, io: { '239': 0, '240': 0 } }),
    ]);
    expect(trayectos).toHaveLength(1);
    expect(trayectos[0]?.fin).toBe(new Date(T0 + 60_000).toISOString());
  });

  it('con el 239 en 0 y RPM en 0 o fuera de rango, sigue apagado', () => {
    const rpmCero = segmentarTrayectosTeltonika([
      punto({ tMs: T0, io: { '239': 0, '240': 1, '85': 0 } }),
      punto({ tMs: T0 + 60_000, lat: -33.46, io: { '239': 0, '240': 1, '85': 0 } }),
    ]);
    expect(rpmCero).toHaveLength(0);

    const rpmInvalido = segmentarTrayectosTeltonika([
      punto({ tMs: T0, io: { '239': 0, '240': 1, '85': 99_999 } }),
      punto({ tMs: T0 + 60_000, lat: -33.46, io: { '239': 0, '240': 1, '85': 99_999 } }),
    ]);
    expect(rpmInvalido).toHaveLength(0);
  });
});

describe('resumirCombustibleVehiculos', () => {
  const OTRO = '33333333-3333-4333-8333-333333333333';
  const TERCERO = '44444444-4444-4444-8444-444444444444';
  const CUARTO = '55555555-5555-4555-8555-555555555555';

  it('toma la mejor fuente de la ventana por vehículo: 84 > 83 > 89 > sin sensor', () => {
    const resumen = resumirCombustibleVehiculos([
      punto({ tMs: T0, io: { '83': 10 } }),
      punto({ tMs: T0 + 1, io: { '84': 500 } }),
      punto({ tMs: T0, vehiculoId: OTRO, patente: 'BBBB22', io: { '89': 50 } }),
      punto({ tMs: T0 + 1, vehiculoId: OTRO, patente: 'BBBB22', io: { '83': 10 } }),
      punto({ tMs: T0, vehiculoId: TERCERO, patente: 'CCCC33', io: { '89': 50 } }),
      punto({ tMs: T0, vehiculoId: CUARTO, patente: 'DDDD44', io: { '239': 1 } }),
    ]);
    expect(resumen).toEqual([
      { vehiculoId: VEHICULO, patente: 'ABCD12', combustible: 'nivel_litros' },
      { vehiculoId: OTRO, patente: 'BBBB22', combustible: 'consumo_can' },
      { vehiculoId: TERCERO, patente: 'CCCC33', combustible: 'nivel_porcentaje' },
      { vehiculoId: CUARTO, patente: 'DDDD44', combustible: 'sin_sensor' },
    ]);
  });

  it('una clave de combustible fuera de rango no cuenta como sensor', () => {
    const resumen = resumirCombustibleVehiculos([punto({ tMs: T0, io: { '84': 99_999 } })]);
    expect(resumen[0]?.combustible).toBe('sin_sensor');
  });
});
