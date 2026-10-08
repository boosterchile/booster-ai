import { randomUUID } from 'node:crypto';
import type { Logger } from '@booster-ai/logger';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import * as schema from '../../src/db/schema.js';
import {
  type EcoRoutingDeps,
  evaluarEcoRoutingAsignacion,
  obtenerSugerenciaRutaActiva,
  registrarRespuestaSugerenciaRuta,
} from '../../src/services/eco-routing-tiempo-real.js';
import { type RouteSuggestion, RoutesApiError } from '../../src/services/routes-api.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * T10-23 (ADR-012 Capa 1) contra Postgres real: posiciones lentas del viaje
 * activo → congestión registrada en `sugerencias_ruta` → push con la
 * alternativa → respuesta explícita del conductor registrada (adopción).
 * Routes API y Web Push se inyectan (no hay red en CI).
 */
const noop = (): void => undefined;
const logger = {
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  fatal: noop,
  child: () => logger,
} as never as Logger;

const uno = <T>(rows: T[], que: string): T => {
  const r = rows[0];
  if (!r) {
    throw new Error(`fixture: ${que} no creado`);
  }
  return r;
};

const ruta = (duracionS: number, km: number, litros: number, poly: string): RouteSuggestion => ({
  distanceKm: km,
  durationS: duracionS,
  fuelL: litros,
  polylineEncoded: poly,
  startLocation: null,
});

describe('integration: eco-routing en tiempo real (T10-23)', () => {
  let handle: TestDbHandle;
  const NOW = Date.parse('2026-10-08T15:00:00Z');

  beforeAll(() => {
    handle = createTestDb();
  });
  afterAll(async () => {
    await handle.pool.end();
  });

  async function fixture(estadoAsignacion: 'asignado' | 'recogido' = 'recogido') {
    const { db } = handle;
    const s = randomUUID().slice(0, 8);
    const plan =
      (
        await db
          .insert(schema.plans)
          .values({
            slug: 'gratis',
            name: `Plan Eco ${s}`,
            description: 'fixture',
            monthlyPriceClp: 0,
            features: {},
          })
          .onConflictDoNothing({ target: schema.plans.slug })
          .returning({ id: schema.plans.id })
      )[0] ?? uno(await db.select({ id: schema.plans.id }).from(schema.plans).limit(1), 'plan');
    const conductor = uno(
      await db
        .insert(schema.users)
        .values({
          firebaseUid: `fb-eco-${s}`,
          email: `eco-${s}@test.invalid`,
          fullName: 'Conductor Eco',
        })
        .returning(),
      'conductor',
    );
    const otro = uno(
      await db
        .insert(schema.users)
        .values({ firebaseUid: `fb-eco2-${s}`, email: `eco2-${s}@test.invalid`, fullName: 'Otro' })
        .returning(),
      'otro',
    );
    const empresa = uno(
      await db
        .insert(schema.empresas)
        .values({
          legalName: `Eco SpA ${s}`,
          rut: `${Math.floor(10000000 + Math.random() * 89999999)}-K`,
          contactEmail: `empresa-eco-${s}@test.invalid`,
          contactPhone: '+56911111111',
          addressStreet: 'Calle 1',
          addressCity: 'Santiago',
          addressRegion: 'RM',
          isTransportista: true,
          isGeneradorCarga: true,
          planId: plan.id,
        })
        .returning(),
      'empresa',
    );
    const vehiculo = uno(
      await db
        .insert(schema.vehicles)
        .values({
          empresaId: empresa.id,
          plate: `EC${s.slice(0, 4).toUpperCase()}`,
          vehicleType: 'camion_mediano',
          capacityKg: 5000,
          fuelType: 'diesel',
          consumptionLPer100kmBaseline: '30.00',
        })
        .returning(),
      'vehículo',
    );
    const viaje = uno(
      await db
        .insert(schema.trips)
        .values({
          trackingCode: randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase(),
          generadorCargaEmpresaId: empresa.id,
          createdByUserId: conductor.id,
          originAddressRaw: 'Av. Apoquindo 4500, Las Condes',
          originLatitude: '-33.4100000',
          originLongitude: '-70.5800000',
          destinationAddressRaw: 'Av. Libertad 100, Viña del Mar',
          cargoType: 'carga_seca',
          cargoWeightKg: 1000,
          pickupDateRaw: '2026-10-08',
          status: 'en_proceso',
        })
        .returning(),
      'viaje',
    );
    const oferta = uno(
      await db
        .insert(schema.offers)
        .values({
          tripId: viaje.id,
          empresaId: empresa.id,
          score: 80,
          proposedPriceClp: 100_000,
          expiresAt: new Date(NOW + 86_400_000),
        })
        .returning(),
      'oferta',
    );
    const asignacion = uno(
      await db
        .insert(schema.assignments)
        .values({
          tripId: viaje.id,
          offerId: oferta.id,
          empresaId: empresa.id,
          vehicleId: vehiculo.id,
          driverUserId: conductor.id,
          agreedPriceClp: 100_000,
          status: estadoAsignacion,
          acceptedAt: new Date(NOW - 3_600_000),
        })
        .returning(),
      'asignación',
    );
    return {
      conductorId: conductor.id,
      otroId: otro.id,
      vehiculoId: vehiculo.id,
      asignacionId: asignacion.id,
    };
  }

  /** 8 posiciones cada 10 s terminando 1 s antes de NOW, con las velocidades dadas. */
  async function posiciones(
    f: { conductorId: string; vehiculoId: string; asignacionId: string },
    velocidades: number[],
  ) {
    const inicio = NOW - 1_000 - (velocidades.length - 1) * 10_000;
    await handle.db.insert(schema.posicionesMovilConductor).values(
      velocidades.map((v, i) => ({
        assignmentId: f.asignacionId,
        vehicleId: f.vehiculoId,
        userId: f.conductorId,
        timestampDevice: new Date(inicio + i * 10_000),
        latitude: '-33.0500000',
        longitude: '-71.4000000',
        speedKmh: v.toFixed(2),
      })),
    );
  }

  function deps(rutas: RouteSuggestion[] | Error) {
    const computeRoutes = vi.fn(async () => {
      if (rutas instanceof Error) {
        throw rutas;
      }
      return rutas;
    });
    const sendPush = vi.fn(async () => ({ sent: 1, invalidated: 0, errored: 0 }));
    const d: EcoRoutingDeps = { computeRoutes, sendPush, now: () => NOW, throttle: new Map() };
    return { d, computeRoutes, sendPush };
  }

  const LENTO = [40, 8, 5, 3, 6, 4, 7, 5];
  const RAPIDO = [60, 55, 58, 62, 50, 57, 61, 59];
  const MEJOR = [ruta(3600, 60, 20, 'actual'), ruta(3700, 52, 15, 'alternativa')];

  test('congestión + alternativa material → fila sugerida, push con acciones y enviada_en', async () => {
    const f = await fixture();
    await posiciones(f, LENTO);
    const { d, computeRoutes, sendPush } = deps(MEJOR);

    const r = await evaluarEcoRoutingAsignacion({
      db: handle.db,
      logger,
      assignmentId: f.asignacionId,
      deps: d,
    });

    expect(r.resultado).toBe('sugerida');
    expect(computeRoutes).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: { lat: -33.05, lng: -71.4 },
        destination: 'Av. Libertad 100, Viña del Mar',
        computeAlternatives: true,
        emissionType: 'DIESEL',
      }),
    );
    const filas = await handle.db
      .select()
      .from(schema.sugerenciasRuta)
      .where(eq(schema.sugerenciasRuta.assignmentId, f.asignacionId));
    expect(filas).toHaveLength(1);
    const fila = filas[0];
    expect(fila?.estado).toBe('sugerida');
    expect(fila?.motivo).toBe('emisiones');
    expect(fila?.alternativePolyline).toBe('alternativa');
    expect(fila?.savingSeconds).toBe(-100);
    expect(Number(fila?.savingKgco2e)).toBeGreaterThan(0);
    expect(fila?.sentAt?.getTime()).toBe(NOW);
    // Detección < 60 s desde que la condición (lento ≥ 60 s) se cumplió.
    const condicionCumplida = (fila?.congestionDesde.getTime() ?? 0) + 60_000;
    expect((fila?.detectedAt.getTime() ?? 0) - condicionCumplida).toBeLessThan(60_000);

    expect(sendPush).toHaveBeenCalledTimes(1);
    const push = sendPush.mock.calls[0]?.[0] as {
      userId: string;
      payload: Record<string, unknown>;
    };
    expect(push.userId).toBe(f.conductorId);
    expect(push.payload).toMatchObject({
      tag: `eco-routing-${f.asignacionId}`,
      data: { assignment_id: f.asignacionId, sugerencia_id: fila?.id, tipo: 'sugerencia_ruta' },
      actions: [
        { action: 'aceptar', title: 'Aceptar' },
        { action: 'seguir', title: 'Seguir mi ruta' },
      ],
    });
  });

  test('cooldown: una segunda evaluación dentro de 15 min no consulta Routes API ni inserta', async () => {
    const f = await fixture();
    await posiciones(f, LENTO);
    await evaluarEcoRoutingAsignacion({
      db: handle.db,
      logger,
      assignmentId: f.asignacionId,
      deps: deps(MEJOR).d,
    });
    const segunda = deps(MEJOR);
    const r = await evaluarEcoRoutingAsignacion({
      db: handle.db,
      logger,
      assignmentId: f.asignacionId,
      deps: segunda.d,
    });
    expect(r.resultado).toBe('cooldown');
    expect(segunda.computeRoutes).not.toHaveBeenCalled();
  });

  test('throttle: dos llamadas seguidas con el mismo store evalúan una sola vez', async () => {
    const f = await fixture();
    await posiciones(f, RAPIDO);
    const { d, computeRoutes } = deps(MEJOR);
    await evaluarEcoRoutingAsignacion({
      db: handle.db,
      logger,
      assignmentId: f.asignacionId,
      deps: d,
    });
    const r = await evaluarEcoRoutingAsignacion({
      db: handle.db,
      logger,
      assignmentId: f.asignacionId,
      deps: d,
    });
    expect(r.resultado).toBe('throttle');
    expect(computeRoutes).not.toHaveBeenCalled();
  });

  test('congestión sin alternativa material → fila congestion_sin_alternativa, sin push', async () => {
    const f = await fixture();
    await posiciones(f, LENTO);
    const { d, sendPush } = deps([ruta(3600, 60, 20, 'actual'), ruta(3700, 61, 21, 'peor')]);
    const r = await evaluarEcoRoutingAsignacion({
      db: handle.db,
      logger,
      assignmentId: f.asignacionId,
      deps: d,
    });
    expect(r.resultado).toBe('congestion_sin_alternativa');
    const [fila] = await handle.db
      .select()
      .from(schema.sugerenciasRuta)
      .where(eq(schema.sugerenciasRuta.assignmentId, f.asignacionId));
    expect(fila?.estado).toBe('congestion_sin_alternativa');
    expect(fila?.alternativePolyline).toBeNull();
    expect(sendPush).not.toHaveBeenCalled();
  });

  test('en movimiento → sin congestión: no llama a Routes API ni inserta', async () => {
    const f = await fixture();
    await posiciones(f, RAPIDO);
    const { d, computeRoutes } = deps(MEJOR);
    const r = await evaluarEcoRoutingAsignacion({
      db: handle.db,
      logger,
      assignmentId: f.asignacionId,
      deps: d,
    });
    expect(r).toEqual({ resultado: 'sin_congestion', razon: 'en_movimiento' });
    expect(computeRoutes).not.toHaveBeenCalled();
  });

  test('asignación sin recogida confirmada → viaje_no_activo', async () => {
    const f = await fixture('asignado');
    await posiciones(f, LENTO);
    const r = await evaluarEcoRoutingAsignacion({
      db: handle.db,
      logger,
      assignmentId: f.asignacionId,
      deps: deps(MEJOR).d,
    });
    expect(r.resultado).toBe('viaje_no_activo');
  });

  test('Routes API falla → error_routes, sin fila (se reintenta en la próxima posición)', async () => {
    const f = await fixture();
    await posiciones(f, LENTO);
    const r = await evaluarEcoRoutingAsignacion({
      db: handle.db,
      logger,
      assignmentId: f.asignacionId,
      deps: deps(new RoutesApiError('timeout', 'timeout', null)).d,
    });
    expect(r.resultado).toBe('error_routes');
    const filas = await handle.db
      .select()
      .from(schema.sugerenciasRuta)
      .where(eq(schema.sugerenciasRuta.assignmentId, f.asignacionId));
    expect(filas).toHaveLength(0);
  });

  test('respuesta del conductor: queda registrada una sola vez y solo por el conductor asignado', async () => {
    const f = await fixture();
    await posiciones(f, LENTO);
    await evaluarEcoRoutingAsignacion({
      db: handle.db,
      logger,
      assignmentId: f.asignacionId,
      deps: deps(MEJOR).d,
    });

    const activa = await obtenerSugerenciaRutaActiva({
      db: handle.db,
      assignmentId: f.asignacionId,
      userId: f.conductorId,
      nowMs: NOW + 5_000,
    });
    expect(activa?.motivo).toBe('emisiones');
    const sid = activa?.id ?? '';

    const ajeno = await registrarRespuestaSugerenciaRuta({
      db: handle.db,
      assignmentId: f.asignacionId,
      sugerenciaId: sid,
      userId: f.otroId,
      respuesta: 'aceptada',
      nowMs: NOW + 10_000,
    });
    expect(ajeno).toBe('forbidden');

    const ok = await registrarRespuestaSugerenciaRuta({
      db: handle.db,
      assignmentId: f.asignacionId,
      sugerenciaId: sid,
      userId: f.conductorId,
      respuesta: 'aceptada',
      nowMs: NOW + 10_000,
    });
    expect(ok).toBe('ok');
    const repetida = await registrarRespuestaSugerenciaRuta({
      db: handle.db,
      assignmentId: f.asignacionId,
      sugerenciaId: sid,
      userId: f.conductorId,
      respuesta: 'rechazada',
      nowMs: NOW + 20_000,
    });
    expect(repetida).toBe('ya_respondida');

    const [fila] = await handle.db
      .select()
      .from(schema.sugerenciasRuta)
      .where(eq(schema.sugerenciasRuta.id, sid));
    expect(fila?.respuesta).toBe('aceptada');
    expect(fila?.respondedAt?.getTime()).toBe(NOW + 10_000);

    expect(
      await obtenerSugerenciaRutaActiva({
        db: handle.db,
        assignmentId: f.asignacionId,
        userId: f.conductorId,
        nowMs: NOW + 30_000,
      }),
    ).toBeNull();
  });

  test('respuesta a una sugerencia inexistente → not_found', async () => {
    const f = await fixture();
    expect(
      await registrarRespuestaSugerenciaRuta({
        db: handle.db,
        assignmentId: f.asignacionId,
        sugerenciaId: randomUUID(),
        userId: f.conductorId,
        respuesta: 'rechazada',
        nowMs: NOW,
      }),
    ).toBe('not_found');
  });
});
