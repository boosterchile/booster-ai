import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { rutAleatorio } from '../helpers/rut-aleatorio.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * `.specs/flota-plataforma` contra Postgres real: la flota de todas las
 * empresas con su última posición, y la ficha de un vehículo con lo que su
 * equipo envía por CAN y los certificados de sus viajes.
 */
const ADMIN_EMAIL = 'admin-flota@boosterchile.invalid';
vi.mock('../../src/config.js', async (original) => {
  const real = await original<typeof import('../../src/config.js')>();
  return { ...real, config: { ...real.config, BOOSTER_PLATFORM_ADMIN_EMAILS: [ADMIN_EMAIL] } };
});
const { createAdminFlotaPlataformaRoutes } = await import(
  '../../src/routes/admin-flota-plataforma.js'
);

const noop = (): void => undefined;
const logger = {
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  fatal: noop,
  child: () => logger,
} as never;

describe('integration: flota de todas las empresas en el panel de plataforma', () => {
  let handle: TestDbHandle;
  beforeAll(() => {
    handle = createTestDb();
  });
  afterAll(async () => {
    await handle.pool.end();
  });

  function uno<T>(rows: T[], que: string): T {
    const row = rows[0];
    if (!row) {
      throw new Error(`fixture: ${que} no creado`);
    }
    return row;
  }
  const app = (email: string | null = ADMIN_EMAIL) => {
    const a = new Hono();
    a.use('*', async (c, next) => {
      if (email) {
        (c as unknown as { set: (k: string, v: unknown) => void }).set('userContext', {
          user: { id: 'admin', email },
        });
      }
      await next();
    });
    a.route('/', createAdminFlotaPlataformaRoutes({ db: handle.db, logger }));
    return a;
  };

  async function empresa(nombre: string) {
    const { db } = handle;
    const [plan] = await db
      .insert(schema.plans)
      .values({
        slug: 'gratis',
        name: 'Plan',
        description: 'fixture',
        monthlyPriceClp: 0,
        features: {},
      })
      .onConflictDoNothing({ target: schema.plans.slug })
      .returning({ id: schema.plans.id });
    const planId =
      plan?.id ?? (await db.select({ id: schema.plans.id }).from(schema.plans).limit(1)).at(0)?.id;
    if (!planId) {
      throw new Error('fixture: plan no disponible');
    }
    const s = randomUUID().slice(0, 8);
    return uno(
      await db
        .insert(schema.empresas)
        .values({
          legalName: `${nombre} ${s}`,
          rut: rutAleatorio(),
          contactEmail: `f-${s}@empresa.invalid`,
          contactPhone: '+56911111111',
          addressStreet: 'Calle 1',
          addressCity: 'Santiago',
          addressRegion: 'RM',
          isTransportista: true,
          isGeneradorCarga: true,
          status: 'activa',
          planId,
        })
        .returning({ id: schema.empresas.id, legalName: schema.empresas.legalName }),
      'empresa',
    );
  }
  async function vehiculo(
    empresaId: string,
    extra: Partial<typeof schema.vehicles.$inferInsert> = {},
  ) {
    return uno(
      await handle.db
        .insert(schema.vehicles)
        .values({
          empresaId,
          plate: `FP${randomUUID().slice(0, 8).toUpperCase()}`,
          vehicleType: 'camion_mediano',
          capacityKg: 5000,
          ...extra,
        })
        .returning({ id: schema.vehicles.id, plate: schema.vehicles.plate }),
      'vehículo',
    );
  }
  const imei = () => `86${String(Math.floor(Math.random() * 1e13)).padStart(13, '0')}`;
  const hace = (minutos: number) => new Date(Date.now() - minutos * 60_000);
  function telemetria(
    vehicleId: string,
    elImei: string,
    puntos: { hace: number; lat?: string; io?: Record<string, number> }[],
  ) {
    return handle.db.insert(schema.telemetryPoints).values(
      puntos.map((p) => ({
        vehicleId,
        imei: elImei,
        timestampDevice: hace(p.hace),
        priority: 0,
        latitude: p.lat ?? '-33.4000000',
        longitude: '-70.6000000',
        speedKmh: 40,
        ioData: p.io ?? {},
      })),
    );
  }

  test('la lista trae vehículos de varias empresas, cada uno con su empresa y su última posición', async () => {
    const a = await empresa('Andes');
    const b = await empresa('Biobío');
    const i1 = imei();
    const conEquipo = await vehiculo(a.id, { teltonikaImei: i1, fuenteCombustibleCan: '83' });
    const sinPosicion = await vehiculo(b.id);
    await telemetria(conEquipo.id, i1, [
      { hace: 30, lat: '-33.1000000' },
      { hace: 5, lat: '-33.2000000' },
    ]);

    const res = await app().request('/');

    expect(res.status).toBe(200);
    const { vehiculos } = (await res.json()) as {
      vehiculos: { id: string; empresa: { id: string; nombre: string }; posicion: unknown }[];
    };
    const deA = vehiculos.find((v) => v.id === conEquipo.id);
    const deB = vehiculos.find((v) => v.id === sinPosicion.id);
    expect(deA).toMatchObject({
      patente: conEquipo.plate,
      empresa: { id: a.id, nombre: a.legalName },
      teltonika_imei: i1,
      fuente_combustible_can: '83',
      // La más reciente, no la primera.
      posicion: { latitud: -33.2, longitud: -70.6, velocidad_kmh: 40, fuente: 'teltonika' },
    });
    expect(deB).toMatchObject({ empresa: { id: b.id, nombre: b.legalName }, posicion: null });
    // Ordenada por empresa: los vehículos de una misma empresa van juntos. El
    // orden entre empresas es el de la base, que depende de su collation.
    const empresasEnOrden = vehiculos.map((v) => v.empresa.id);
    const bloques = empresasEnOrden.filter((id, i) => id !== empresasEnOrden[i - 1]);
    expect(new Set(bloques).size).toBe(bloques.length);
  });

  test('sin acceso al panel no entrega la flota', async () => {
    expect((await app('dueno@transportes.invalid').request('/')).status).toBe(403);
    expect((await app(null).request('/')).status).toBe(401);
  });

  test('la ficha avisa de un equipo que envía el combustible por CAN sin estar configurado', async () => {
    const a = await empresa('Cordillera');
    const i1 = imei();
    const v = await vehiculo(a.id, { teltonikaImei: i1, brand: 'Scania', fuelType: 'diesel' });
    await telemetria(v.id, i1, [
      { hace: 60, io: { '83': 1200, '89': 70 } },
      { hace: 30, io: { '83': 1215, '89': 69 } },
      { hace: 10, io: { '89': 69 } },
      // Fuera de la ventana de 3 días: no cuenta.
      { hace: 60 * 24 * 5, io: { '83': 900, '84': 300 } },
    ]);

    const res = await app().request(`/${v.id}`);

    expect(res.status).toBe(200);
    const json = (await res.json()) as { vehiculo: unknown; can: Record<string, unknown> };
    expect(json.vehiculo).toMatchObject({
      patente: v.plate,
      marca: 'Scania',
      combustible: 'diesel',
      empresa: { id: a.id, nombre: a.legalName },
    });
    expect(json.can).toMatchObject({
      fuente_configurada: 'sin_sensor',
      ventana_dias: 3,
      puntos: 3,
      con_combustible_83: 2,
      con_nivel_84: 0,
      con_nivel_89: 3,
      aviso: null,
    });
    expect(new Date(String(json.can.ultima_lectura_en)).getTime()).toBeCloseTo(
      hace(10).getTime(),
      -4,
    );
  });

  test('la ficha cuenta los viajes del vehículo y sus certificados por nivel', async () => {
    const a = await empresa('Del Sur');
    const v = await vehiculo(a.id);
    const otro = await vehiculo(a.id);
    const viaje = async (
      vehicleId: string,
      estado: 'asignado' | 'entregado',
      metricas?: {
        nivel: 'primario_verificable' | 'secundario_modeled';
        emitido: boolean;
        fuente?: 'teltonika_gps' | 'maps_directions';
        coberturaPct?: string;
      },
    ) => {
      const { db } = handle;
      const t = uno(
        await db
          .insert(schema.trips)
          .values({
            trackingCode: randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase(),
            generadorCargaEmpresaId: a.id,
            originAddressRaw: 'Origen',
            destinationAddressRaw: 'Destino',
            cargoType: 'carga_seca',
            cargoWeightKg: 1000,
            pickupDateRaw: '2026-11-10',
            status: estado,
          })
          .returning({ id: schema.trips.id, trackingCode: schema.trips.trackingCode }),
        'viaje',
      );
      const oferta = uno(
        await db
          .insert(schema.offers)
          .values({
            tripId: t.id,
            empresaId: a.id,
            score: 80,
            proposedPriceClp: 100_000,
            expiresAt: new Date(Date.now() + 3_600_000),
          })
          .returning({ id: schema.offers.id }),
        'oferta',
      );
      await db.insert(schema.assignments).values({
        tripId: t.id,
        offerId: oferta.id,
        empresaId: a.id,
        vehicleId,
        agreedPriceClp: 100_000,
        status: estado,
        acceptedAt: hace(120),
        deliveredAt: estado === 'entregado' ? hace(60) : null,
      });
      if (metricas) {
        await db.insert(schema.tripMetrics).values({
          tripId: t.id,
          certificationLevel: metricas.nivel,
          routeDataSource: metricas.fuente ?? null,
          coveragePct: metricas.coberturaPct ?? null,
          certificateIssuedAt: metricas.emitido ? hace(55) : null,
        });
      }
      return t.trackingCode;
    };
    await viaje(v.id, 'asignado');
    const primario = await viaje(v.id, 'entregado', {
      nivel: 'primario_verificable',
      emitido: true,
    });
    await viaje(v.id, 'entregado', {
      nivel: 'secundario_modeled',
      emitido: true,
      fuente: 'teltonika_gps',
      coberturaPct: '96.40',
    });
    await viaje(v.id, 'entregado', {
      nivel: 'secundario_modeled',
      emitido: true,
      fuente: 'maps_directions',
      coberturaPct: '0.00',
    });
    await viaje(v.id, 'entregado', { nivel: 'secundario_modeled', emitido: false });
    // De otro vehículo de la misma empresa: no cuenta.
    await viaje(otro.id, 'entregado', { nivel: 'primario_verificable', emitido: true });

    const json = (await (await app().request(`/${v.id}`)).json()) as {
      can: unknown;
      viajes: { ultimos: { codigo_seguimiento: string }[] };
    };

    expect(json.can).toBeNull();
    expect(json.viajes).toMatchObject({
      entregados: 4,
      en_curso: 1,
      certificados: {
        primario_verificable: 1,
        secundario_modeled: 2,
        secundario_default: 0,
        sin_certificado: 1,
        // ADR-091: la distancia medida por Teltonika se cuenta aparte.
        por_presentacion: { primario: 1, medido_teltonika: 1, estimado: 1 },
      },
    });
    expect(json.viajes.ultimos).toHaveLength(5);
    expect(json.viajes.ultimos.map((u) => u.codigo_seguimiento)).toContain(primario);
  });

  test('un vehículo que no existe responde 404', async () => {
    expect((await app().request(`/${randomUUID()}`)).status).toBe(404);
  });
});
