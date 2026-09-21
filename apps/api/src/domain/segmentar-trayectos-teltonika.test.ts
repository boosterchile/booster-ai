import { describe, expect, it } from 'vitest';
import { haversineKm } from '../services/calcular-cobertura-telemetria.js';
import {
  GAP_CORTE_MS,
  NOTA_NIVEL_SUBIO,
  NOTA_SIN_BAJA,
  NOTA_SIN_LECTURA,
  type PuntoSegmentacion,
  UMBRAL_ROBO_BASE_L,
  segmentarTrayectosTeltonika,
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

describe('umbralRoboLitros', () => {
  it('sin capacidad conocida usa 15 L', () => {
    expect(umbralRoboLitros(null)).toBe(UMBRAL_ROBO_BASE_L);
    expect(umbralRoboLitros(0)).toBe(UMBRAL_ROBO_BASE_L);
    expect(umbralRoboLitros(Number.NaN)).toBe(UMBRAL_ROBO_BASE_L);
  });

  it('con estanque, U = max(15, 3 % de la capacidad)', () => {
    expect(umbralRoboLitros(400)).toBe(15);
    expect(umbralRoboLitros(1000)).toBe(30);
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
        lat: -33.46,
        io: { '239': 1, '240': 1, '84': 800 },
      }),
    ]);
    const dist = haversineKm(-33.45, -70.66, -33.46, -70.66);
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

  it('solo el porcentaje 89 no se convierte a litros', () => {
    const trayectos = segmentarTrayectosTeltonika([
      punto({ tMs: T0, io: { '239': 1, '240': 1, '89': 80 } }),
      punto({ tMs: T0 + 60_000, lat: -33.46, io: { '239': 1, '240': 1, '89': 40 } }),
    ]);
    expect(trayectos[0]).toMatchObject({
      litrosIniciales: null,
      litrosFinales: null,
      kmPorLitro: null,
      posibleRoboCombustible: false,
      sensorCombustible: 'degradado',
      notaCombustible: NOTA_SIN_LECTURA,
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

  it('con estanque de 1000 L el umbral sube a 30 L', () => {
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
        io: { '239': 0, '240': 0, '84': 600 },
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
        io: { '239': 0, '240': 0, '84': 1000 },
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

  it('una caída de menos de 15 L no marca robo si no hay capacidad', () => {
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
        io: { '239': 0, '240': 0, '84': 360 },
      }),
    ]);
    expect(trayectos[0]?.posibleRoboCombustible).toBe(false);
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
