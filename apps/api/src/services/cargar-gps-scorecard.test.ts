import type { Logger } from '@booster-ai/logger';
import { getTableName } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../db/client.js';
import { cargarScorecardMedioPlazo } from './cargar-gps-scorecard.js';

const AHORA = new Date('2026-09-21T12:00:00.000Z');
const T0 = new Date('2026-09-01T12:00:00.000Z');
const FIN = new Date(T0.getTime() + 10 * 60_000);

function resultado(rows: unknown[]) {
  const promise = Promise.resolve(rows) as Promise<unknown[]> & {
    groupBy: () => Promise<unknown[]>;
  };
  promise.groupBy = () => Promise.resolve(rows);
  return promise;
}

function colaDb(pasos: unknown[][]) {
  const tablas: string[] = [];
  let i = 0;
  const db = {
    select: () => {
      const rows = pasos[i] ?? [];
      i += 1;
      const chain = {
        from: (tabla: unknown) => {
          tablas.push(getTableName(tabla as never));
          return chain;
        },
        innerJoin: (tabla: unknown) => {
          tablas.push(getTableName(tabla as never));
          return chain;
        },
        where: () => resultado(rows),
      };
      return chain;
    },
  };
  return { db: db as unknown as Db, tablas, llamadas: () => i };
}

function logger(): Logger & { info: ReturnType<typeof vi.fn> } {
  const info = vi.fn();
  const base = {
    info,
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: () => base,
  };
  return base as unknown as Logger & { info: ReturnType<typeof vi.fn> };
}

describe('cargarScorecardMedioPlazo', () => {
  it('calcula teléfono, flota y dual desde las filas, y deja fuera demo y null island', async () => {
    const log = logger();
    const cobertura: number[] = [];
    const { db, tablas } = colaDb([
      [
        {
          viajeId: 'viaje-1',
          asignacionId: 'asig-1',
          vehicleId: 'veh-1',
          teltonikaImei: '860111',
          esDemo: false,
          esUsuarioPrueba: false,
          recogidoEn: T0,
          entregadoEn: FIN,
          canceladoEn: null,
        },
        {
          viajeId: 'demo',
          asignacionId: 'asig-demo',
          vehicleId: 'veh-demo',
          teltonikaImei: '860222',
          esDemo: true,
          esUsuarioPrueba: false,
          recogidoEn: T0,
          entregadoEn: FIN,
          canceladoEn: null,
        },
        {
          viajeId: 'roto',
          asignacionId: 'asig-roto',
          vehicleId: 'veh-1',
          teltonikaImei: '860111',
          esDemo: false,
          esUsuarioPrueba: false,
          recogidoEn: FIN,
          entregadoEn: T0,
          canceladoEn: null,
        },
      ],
      [
        {
          asignacionId: 'asig-1',
          timestampDevice: new Date(T0.getTime() + 10_000),
          timestampRecibido: new Date(T0.getTime() + 11_000),
          precisionM: '20.00',
          lat: '-33.0400000',
          lng: '-71.6200000',
        },
        {
          asignacionId: 'asig-1',
          timestampDevice: new Date(T0.getTime() + 130_000),
          timestampRecibido: new Date(T0.getTime() + 131_000),
          precisionM: '8.00',
          lat: '0',
          lng: '0',
        },
        {
          asignacionId: null,
          timestampDevice: new Date(T0.getTime() + 10_000),
          timestampRecibido: new Date(T0.getTime() + 11_000),
          precisionM: '5.00',
          lat: '-33.0400000',
          lng: '-71.6200000',
        },
      ],
      [
        {
          vehicleId: 'veh-1',
          timestampDevice: new Date(T0.getTime() + 10_000),
          timestampRecibido: new Date(T0.getTime() + 12_000),
          lat: '-33.0400000',
          lng: '-71.6200000',
        },
      ],
      [
        { vehicleId: 'veh-1', teltonikaImei: '860111', esDemo: false, esUsuarioPrueba: false },
        { vehicleId: 'veh-demo', teltonikaImei: '860222', esDemo: true, esUsuarioPrueba: false },
      ],
      [{ vehicleId: 'veh-1', n: 3 }],
    ]);

    const scorecard = await cargarScorecardMedioPlazo({
      db,
      logger: log,
      ahora: AHORA,
      instrumentos: {
        coberturaUsablePct: {
          record: (value: number) => {
            cobertura.push(value);
          },
        },
        viajesConGap: {
          add: () => undefined,
        },
        gapsDetectados: {
          add: () => undefined,
        },
        flotaTeltonikaPct: {
          record: () => undefined,
        },
        dualDeltaPct: {
          record: () => undefined,
        },
      },
    });

    expect(tablas).toEqual([
      'asignaciones',
      'vehiculos',
      'empresas',
      'posiciones_movil_conductor',
      'telemetria_puntos',
      'asignaciones',
      'vehiculos',
      'empresas',
      'telemetria_puntos',
    ]);
    expect(scorecard.fuenteEdad).toBe('desfase_recepcion_ms');
    expect(scorecard.precondicionNavWakeLockEstable).toBe(false);
    expect(scorecard.viajesEvaluados).toBe(1);
    expect(scorecard.viajesDescartados).toBe(1);
    expect(scorecard.telefono.cobertura.medianaPct).toBe(20);
    expect(scorecard.telefono.cobertura.compuerta).toBe('muestra_insuficiente');
    expect(scorecard.telefono.gaps.gapsSobre15Min).toBe(0);
    expect(scorecard.telefono.gaps.viajesConGapSobre5Min).toBe(1);
    expect(scorecard.flota.pct).toBe(100);
    expect(scorecard.flota.compuerta).toBe('cumple');
    expect(scorecard.dual.viajesComparados).toBe(1);
    expect(scorecard.dual.medianaDeltaPct).toBe(0);
    expect(scorecard.decision.cambiaStack).toBe(false);
    expect(scorecard.decision.nativo).toBe('no_evaluar_nativo');
    expect(scorecard.decision.teltonikaPrimero).toBe('umbral_flota_alcanzado_lectura_humana');
    expect(cobertura).toEqual([20]);
    expect(log.info).toHaveBeenCalledOnce();
  });

  it('sin viajes medibles no inventa flota ni lee posiciones', async () => {
    const { db, tablas, llamadas } = colaDb([[], []]);
    const scorecard = await cargarScorecardMedioPlazo({
      db,
      logger: logger(),
      ahora: AHORA,
      precondicionNavWakeLockEstable: true,
    });
    expect(llamadas()).toBe(2);
    expect(tablas).not.toContain('posiciones_movil_conductor');
    expect(scorecard.viajesEvaluados).toBe(0);
    expect(scorecard.flota.compuerta).toBe('sin_flota');
    expect(scorecard.decision.nativo).toBe('muestra_insuficiente');
    expect(scorecard.decision.teltonikaPrimero).toBe('sin_flota');
  });

  it('trocea la lectura cuando hay más vehículos que el tamaño del lote', async () => {
    const asignaciones = [
      {
        viajeId: 'v-a',
        asignacionId: 'a',
        vehicleId: 'veh-a',
        teltonikaImei: '111',
        esDemo: false,
        esUsuarioPrueba: false,
        recogidoEn: T0,
        entregadoEn: FIN,
        canceladoEn: null,
      },
      {
        viajeId: 'v-b',
        asignacionId: 'b',
        vehicleId: 'veh-b',
        teltonikaImei: null,
        esDemo: false,
        esUsuarioPrueba: false,
        recogidoEn: T0,
        entregadoEn: FIN,
        canceladoEn: null,
      },
    ];
    const { db, llamadas } = colaDb([
      asignaciones,
      [],
      [],
      [],
      [
        { vehicleId: 'veh-a', teltonikaImei: '111', esDemo: false, esUsuarioPrueba: false },
        { vehicleId: 'veh-b', teltonikaImei: null, esDemo: false, esUsuarioPrueba: false },
      ],
      [{ vehicleId: 'veh-a', n: 1 }],
    ]);
    const scorecard = await cargarScorecardMedioPlazo({
      db,
      logger: logger(),
      ahora: AHORA,
      tamanoTrozo: 1,
    });
    expect(llamadas()).toBe(6);
    expect(scorecard.viajesEvaluados).toBe(2);
    expect(scorecard.flota.vehiculosConViaje30d).toBe(2);
    expect(scorecard.flota.vehiculosConDeviceYHeartbeat).toBe(1);
    expect(scorecard.flota.pct).toBe(50);
  });

  it('descarta filas incompletas y cuenta 0 latidos cuando el device no aparece', async () => {
    const { db } = colaDb([
      [
        {
          viajeId: 'cancelado',
          asignacionId: 'asig-c',
          vehicleId: 'veh-1',
          teltonikaImei: '860111',
          esDemo: false,
          esUsuarioPrueba: false,
          recogidoEn: T0,
          entregadoEn: null,
          canceladoEn: FIN,
        },
        {
          viajeId: 'abierto',
          asignacionId: 'asig-abierto',
          vehicleId: 'veh-1',
          teltonikaImei: '860111',
          esDemo: false,
          esUsuarioPrueba: false,
          recogidoEn: T0,
          entregadoEn: null,
          canceladoEn: null,
        },
        {
          viajeId: 'sin-recogida',
          asignacionId: 'asig-null',
          vehicleId: 'veh-1',
          teltonikaImei: '860111',
          esDemo: false,
          esUsuarioPrueba: false,
          recogidoEn: null,
          entregadoEn: FIN,
          canceladoEn: null,
        },
        {
          viajeId: 'reloj',
          asignacionId: 'asig-reloj',
          vehicleId: 'veh-1',
          teltonikaImei: '860111',
          esDemo: false,
          esUsuarioPrueba: false,
          recogidoEn: new Date(Number.NaN),
          entregadoEn: FIN,
          canceladoEn: null,
        },
      ],
      [
        {
          asignacionId: 'asig-c',
          timestampDevice: new Date(T0.getTime() + 10_000),
          timestampRecibido: new Date(T0.getTime() + 11_000),
          precisionM: '15.5',
          lat: '-33.0400000',
          lng: '-71.6200000',
        },
        {
          asignacionId: 'asig-c',
          timestampDevice: new Date(T0.getTime() + 130_000),
          timestampRecibido: new Date(T0.getTime() + 131_000),
          precisionM: null,
          lat: '-33.0400000',
          lng: '-71.6200000',
        },
        {
          asignacionId: 'asig-c',
          timestampDevice: new Date(T0.getTime() + 20_000),
          timestampRecibido: new Date(T0.getTime() + 21_000),
          precisionM: 'no-num',
          lat: '-33.0400000',
          lng: '-71.6200000',
        },
        {
          asignacionId: 'asig-c',
          timestampDevice: new Date(T0.getTime() + 20_000),
          timestampRecibido: new Date(T0.getTime() + 21_000),
          precisionM: '10',
          lat: null,
          lng: '-71.6200000',
        },
        {
          asignacionId: 'asig-c',
          timestampDevice: new Date(T0.getTime() + 20_000),
          timestampRecibido: new Date(Number.NaN),
          precisionM: '10',
          lat: 'no-coord',
          lng: '-71.6200000',
        },
      ],
      [
        {
          vehicleId: 'veh-1',
          timestampDevice: new Date(T0.getTime() + 10_000),
          timestampRecibido: new Date(T0.getTime() + 11_000),
          lat: '-33.0400000',
          lng: '-71.6200000',
        },
        {
          vehicleId: 'veh-1',
          timestampDevice: new Date(Number.NaN),
          timestampRecibido: new Date(T0.getTime()),
          lat: null,
          lng: null,
        },
      ],
      [
        { vehicleId: 'veh-1', teltonikaImei: '860111', esDemo: false, esUsuarioPrueba: false },
        { vehicleId: 'veh-2', teltonikaImei: '860333', esDemo: false, esUsuarioPrueba: false },
        { vehicleId: 'veh-blanco', teltonikaImei: '   ', esDemo: false, esUsuarioPrueba: false },
        { vehicleId: 'veh-sin', teltonikaImei: null, esDemo: false, esUsuarioPrueba: false },
      ],
      [{ vehicleId: 'veh-1', n: '2' }],
    ]);

    const scorecard = await cargarScorecardMedioPlazo({
      db,
      logger: logger(),
      ahora: AHORA,
    });
    expect(scorecard.viajesEvaluados).toBe(1);
    expect(scorecard.viajesDescartados).toBe(1);
    expect(scorecard.telefono.cobertura.medianaPct).toBe(20);
    expect(scorecard.flota.vehiculosConViaje30d).toBe(4);
    expect(scorecard.flota.vehiculosConDeviceYHeartbeat).toBe(1);
    expect(scorecard.flota.pct).toBe(25);
  });

  it('rechaza un conteo de latido que no es número y una fecha inválida', async () => {
    const { db } = colaDb([
      [
        {
          viajeId: 'v',
          asignacionId: 'a',
          vehicleId: 'veh',
          teltonikaImei: '111',
          esDemo: false,
          esUsuarioPrueba: false,
          recogidoEn: T0,
          entregadoEn: FIN,
          canceladoEn: null,
        },
      ],
      [],
      [],
      [{ vehicleId: 'veh', teltonikaImei: '111', esDemo: false, esUsuarioPrueba: false }],
      [{ vehicleId: 'veh', n: 'no-es-numero' }],
    ]);
    await expect(cargarScorecardMedioPlazo({ db, logger: logger(), ahora: AHORA })).rejects.toThrow(
      'conteo invalido en heartbeats7d',
    );
    await expect(
      cargarScorecardMedioPlazo({
        db,
        logger: logger(),
        ahora: new Date(Number.NaN),
      }),
    ).rejects.toThrow('ahora invalido');
  });

  it('propaga el fallo de la base', async () => {
    const db = {
      select: () => {
        throw new Error('db down');
      },
    } as unknown as Db;
    await expect(cargarScorecardMedioPlazo({ db, logger: logger(), ahora: AHORA })).rejects.toThrow(
      'db down',
    );
  });
});
