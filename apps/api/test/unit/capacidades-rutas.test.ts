import { Hono } from 'hono';
import { beforeAll, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  process.env.GOOGLE_CLOUD_PROJECT = 'test';
});

vi.mock('../../src/services/offer-actions.js', () => ({
  acceptOffer: vi.fn(async () => ({
    offer: { id: 'o', status: 'aceptada', respondedAt: new Date('2026-10-20T00:00:00Z') },
    assignment: {
      id: 'a',
      tripId: 't',
      status: 'asignado',
      agreedPriceClp: 1000,
      acceptedAt: new Date('2026-10-20T00:00:00Z'),
    },
    supersededOfferIds: [],
  })),
  rejectOffer: vi.fn(async () => ({
    id: 'o',
    status: 'rechazada',
    respondedAt: new Date('2026-10-20T00:00:00Z'),
  })),
  OfferNotFoundError: class OfferNotFoundError extends Error {},
  OfferNotOwnedError: class OfferNotOwnedError extends Error {},
  OfferNotPendingError: class OfferNotPendingError extends Error {
    status = 'aceptada';
  },
  OfferExpiredError: class OfferExpiredError extends Error {},
  TripNotAcceptableError: class TripNotAcceptableError extends Error {
    tripStatus = 'asignado';
  },
}));

const { acceptOffer } = await import('../../src/services/offer-actions.js');
const { config: appConfig } = await import('../../src/config.js');

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

const EMPRESA = '22222222-2222-4222-8222-222222222222';
const USER = '11111111-1111-4111-8111-111111111111';
const OTRO = '33333333-3333-4333-8333-333333333333';
const OFFER = '44444444-4444-4444-8444-444444444444';
const ASIG = '55555555-5555-4555-8555-555555555555';
const VEH = '66666666-6666-4666-8666-666666666666';

function sesion(role: string, extra?: { flag?: boolean; carrier?: boolean; shipper?: boolean }) {
  return {
    user: { id: USER },
    memberships: [],
    activeMembership: {
      membership: {
        id: 'm-1',
        role,
        puedeAceptarOfertas: extra?.flag === true,
        empresaId: EMPRESA,
      },
      empresa: {
        id: EMPRESA,
        legalName: 'Transporte Ejemplo',
        isTransportista: extra?.carrier !== false,
        isGeneradorCarga: extra?.shipper === true,
        status: 'activa',
      },
    },
  };
}

function appCon(ruta: Hono, ctx: ReturnType<typeof sesion>) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userContext', ctx);
    await next();
  });
  app.route('/', ruta);
  return app;
}

describe('plata solo dueño y admin', () => {
  it('despachador no lee liquidaciones', async () => {
    appConfig.PRICING_V2_ACTIVATED = true;
    const { createMeLiquidacionesRoutes } = await import('../../src/routes/me-liquidaciones.js');
    const app = appCon(
      createMeLiquidacionesRoutes({ db: {} as never, logger }),
      sesion('despachador'),
    );
    const res = await app.request('/liquidaciones');
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      code: 'capability_denied',
      capability: 'puedeVerFinanzas',
    });
  });

  it('conductor no pide Cobra hoy ni ve el historial', async () => {
    appConfig.FACTORING_V1_ACTIVATED = true;
    const { createCobraHoyAssignmentsRoutes, createCobraHoyMeRoutes } = await import(
      '../../src/routes/cobra-hoy.js'
    );
    const post = appCon(
      createCobraHoyAssignmentsRoutes({ db: {} as never, logger }),
      sesion('conductor'),
    );
    const resPost = await post.request(`/${ASIG}/cobra-hoy`, { method: 'POST' });
    expect(resPost.status).toBe(403);
    expect(await resPost.json()).toMatchObject({ capability: 'puedeVerFinanzas' });

    const hist = appCon(
      createCobraHoyMeRoutes({ db: {} as never, logger }),
      sesion('visualizador'),
    );
    const resHist = await hist.request('/cobra-hoy/historial');
    expect(resHist.status).toBe(403);
  });

  it('dueño pasa el gate de liquidaciones', async () => {
    appConfig.PRICING_V2_ACTIVATED = true;
    const chain: Record<string, unknown> = {};
    chain.from = () => chain;
    chain.innerJoin = () => chain;
    chain.where = () => chain;
    chain.orderBy = () => chain;
    chain.limit = async () => [];
    const { createMeLiquidacionesRoutes } = await import('../../src/routes/me-liquidaciones.js');
    const app = appCon(
      createMeLiquidacionesRoutes({
        db: { select: () => chain } as never,
        logger,
      }),
      sesion('dueno'),
    );
    const res = await app.request('/liquidaciones');
    expect(res.status).toBe(200);
  });
});

describe('ofertas', () => {
  it('conductor y despachador sin flag no aceptan', async () => {
    const { createOfferRoutes } = await import('../../src/routes/offers.js');
    for (const role of ['conductor', 'despachador', 'visualizador'] as const) {
      vi.mocked(acceptOffer).mockClear();
      const app = appCon(
        createOfferRoutes({ db: {} as never, logger }),
        sesion(role, { flag: role === 'visualizador' }),
      );
      const res = await app.request(`/${OFFER}/accept`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ capability: 'puedeAceptarOferta' });
      expect(acceptOffer).not.toHaveBeenCalled();
    }
  });

  it('despachador con flag no es rechazado por capacidad', async () => {
    const { createOfferRoutes } = await import('../../src/routes/offers.js');
    vi.mocked(acceptOffer).mockClear();
    const app = appCon(
      createOfferRoutes({ db: {} as never, logger }),
      sesion('despachador', { flag: true }),
    );
    const res = await app.request(`/${OFFER}/accept`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).not.toBe(403);
    expect(acceptOffer).toHaveBeenCalled();
  });
});

describe('visualizador no escribe cargas ni chat', () => {
  it('crear y cancelar una carga responde read_only', async () => {
    const { createTripRequestsV2Routes } = await import('../../src/routes/trip-requests-v2.js');
    const app = appCon(
      createTripRequestsV2Routes({ db: {} as never, logger }),
      sesion('visualizador', { shipper: true, carrier: false }),
    );
    const ahora = Date.now();
    const crear = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        origin: { address_raw: 'Av. Ejemplo 100', region_code: 'XIII' },
        destination: { address_raw: 'Centro Ejemplo', region_code: 'VIII' },
        cargo: { cargo_type: 'carga_seca', weight_kg: 1500 },
        pickup_window: {
          start_at: new Date(ahora + 86_400_000).toISOString(),
          end_at: new Date(ahora + 122_400_000).toISOString(),
        },
        proposed_price_clp: 250000,
      }),
    });
    expect(crear.status).toBe(403);
    expect(await crear.json()).toMatchObject({ code: 'read_only' });

    const cancelar = await app.request(`/${ASIG}/cancelar`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'prueba' }),
    });
    expect(cancelar.status).toBe(403);
    expect(await cancelar.json()).toMatchObject({ code: 'read_only' });
  });

  it('no envía mensajes de chat', async () => {
    const chain: Record<string, unknown> = {};
    chain.from = () => chain;
    chain.innerJoin = () => chain;
    chain.where = () => chain;
    chain.limit = async () => [
      {
        assignmentId: ASIG,
        assignmentStatus: 'asignado',
        carrierEmpresaId: EMPRESA,
        shipperEmpresaId: OTRO,
        driverUserId: OTRO,
      },
    ];
    const { createChatRoutes } = await import('../../src/routes/chat.js');
    const app = appCon(
      createChatRoutes({ db: { select: () => chain } as never, logger }),
      sesion('visualizador'),
    );
    const res = await app.request(`/${ASIG}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'texto', text: 'hola' }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'read_only' });
  });
});

describe('conductor empleado solo ve su viaje', () => {
  it('la flota le vuelve vacía', async () => {
    const vehiculos = [
      {
        id: VEH,
        plate: 'TEST01',
        type: 'camion_pequeno',
        teltonika_imei: null,
        teltonika_imei_espejo: null,
        status: 'activo',
      },
    ];
    let n = 0;
    const db = {
      select: () => ({
        from: () => ({
          where: () => {
            n += 1;
            if (n === 1) {
              return { orderBy: async () => vehiculos };
            }
            return Promise.resolve([]);
          },
        }),
      }),
      selectDistinctOn: () => ({
        from: () => ({ where: () => ({ orderBy: async () => [] }) }),
      }),
    };
    const { createVehiculosRoutes } = await import('../../src/routes/vehiculos.js');
    const app = appCon(createVehiculosRoutes({ db: db as never, logger }), sesion('conductor'));
    const res = await app.request('/flota');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { fleet: unknown[] };
    expect(body.fleet).toEqual([]);
  });

  it('ubicación de un vehículo que no es suyo responde solo_su_viaje', async () => {
    let n = 0;
    const vehiculo = {
      id: VEH,
      plate: 'TEST01',
      teltonikaImei: null,
      teltonikaImeiEspejo: null,
      tieneSensorTemperatura: false,
    };
    const db = {
      select: () => ({
        from: () => ({
          where: () => {
            n += 1;
            const filas = n === 1 ? [vehiculo] : [];
            const builder: Record<string, unknown> = {};
            builder.limit = async () => filas;
            builder.orderBy = () => builder;
            builder.then = (resolve: (v: unknown) => unknown) => resolve(filas);
            return builder;
          },
        }),
      }),
    };
    const { createVehiculosRoutes } = await import('../../src/routes/vehiculos.js');
    const app = appCon(createVehiculosRoutes({ db: db as never, logger }), sesion('conductor'));
    const res = await app.request(`/${VEH}/ubicacion`);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'solo_su_viaje' });
  });

  it('el detalle de una asignación ajena responde solo_su_viaje', async () => {
    const chain: Record<string, unknown> = {};
    chain.from = () => chain;
    chain.innerJoin = () => chain;
    chain.leftJoin = () => chain;
    chain.where = () => chain;
    chain.limit = async () => [
      {
        assignmentId: ASIG,
        assignmentStatus: 'asignado',
        agreedPriceClp: 1000,
        acceptedAt: new Date('2026-10-20T00:00:00Z'),
        pickedUpAt: null,
        deliveredAt: null,
        cancelledAt: null,
        empresaIdAssign: EMPRESA,
        empresaLegalName: 'Transporte Ejemplo',
        vehicleId: null,
        vehiclePlate: null,
        vehicleStatus: null,
        vehicleType: null,
        driverUserId: OTRO,
        driverName: null,
        tripId: 't',
        trackingCode: 'TR-1',
        tripStatus: 'asignado',
        originAddressRaw: 'Origen',
        originRegionCode: 'XIII',
        destinationAddressRaw: 'Destino',
        destinationRegionCode: 'VIII',
        cargoType: 'carga_seca',
        cargoWeightKg: 100,
        cargoVolumeM3: null,
        pickupWindowStart: null,
        pickupWindowEnd: null,
        proposedPriceClp: 1000,
        shipperLegalName: 'Generador Ejemplo',
      },
    ];
    const { createAssignmentsRoutes } = await import('../../src/routes/assignments.js');
    const app = appCon(
      createAssignmentsRoutes({
        db: { select: () => chain } as never,
        logger,
        geofenceRadiusM: 150,
      }),
      sesion('conductor'),
    );
    const res = await app.request(`/${ASIG}`);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'solo_su_viaje' });
  });

  it('la flota del conductor solo mira asignaciones vigentes', async () => {
    const vehiculos = [
      {
        id: VEH,
        plate: 'TEST01',
        type: 'camion_pequeno',
        teltonika_imei: null,
        teltonika_imei_espejo: null,
        status: 'activo',
      },
    ];
    let n = 0;
    let filtro: unknown;
    const db = {
      select: () => ({
        from: () => ({
          where: (clause: unknown) => {
            n += 1;
            if (n === 1) {
              return { orderBy: async () => vehiculos };
            }
            filtro = clause;
            return Promise.resolve([]);
          },
        }),
      }),
      selectDistinctOn: () => ({
        from: () => ({ where: () => ({ orderBy: async () => [] }) }),
      }),
    };
    const { createVehiculosRoutes } = await import('../../src/routes/vehiculos.js');
    const app = appCon(createVehiculosRoutes({ db: db as never, logger }), sesion('conductor'));
    const res = await app.request('/flota');
    expect(res.status).toBe(200);
    const texto = textoSql(filtro);
    expect(texto).toContain('in  asignado recogido');
  });
});

function textoSql(value: unknown, seen = new Set<unknown>()): string {
  if (value == null || typeof value === 'function') {
    return '';
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return ` ${value}`;
  }
  if (typeof value !== 'object') {
    return '';
  }
  if (seen.has(value)) {
    return '';
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => textoSql(item, seen)).join('');
  }
  return Object.values(value as Record<string, unknown>)
    .map((item) => textoSql(item, seen))
    .join('');
}

describe('sin contexto de capacidades se niega', () => {
  it('flota, asignación y chat no se abren si el rol no arma contexto', async () => {
    const roto = sesion('operador');
    const { createVehiculosRoutes } = await import('../../src/routes/vehiculos.js');
    const flota = await appCon(
      createVehiculosRoutes({
        db: {
          select() {
            throw new Error('no debe leer');
          },
        } as never,
        logger,
      }),
      roto,
    ).request('/flota');
    expect(flota.status).toBe(403);
    expect(await flota.json()).toMatchObject({ code: 'capability_denied' });

    const { createAssignmentsRoutes } = await import('../../src/routes/assignments.js');
    const lista = await appCon(
      createAssignmentsRoutes({
        db: {
          select() {
            throw new Error('no debe leer');
          },
        } as never,
        logger,
        geofenceRadiusM: 150,
      }),
      roto,
    ).request('/');
    expect(lista.status).toBe(403);
    expect(await lista.json()).toMatchObject({ code: 'capability_denied' });

    const chain: Record<string, unknown> = {};
    chain.from = () => chain;
    chain.innerJoin = () => chain;
    chain.where = () => chain;
    chain.limit = async () => [
      {
        assignmentId: ASIG,
        assignmentStatus: 'asignado',
        carrierEmpresaId: EMPRESA,
        shipperEmpresaId: EMPRESA,
        driverUserId: USER,
      },
    ];
    const { createChatRoutes } = await import('../../src/routes/chat.js');
    const chat = await appCon(
      createChatRoutes({ db: { select: () => chain } as never, logger }),
      roto,
    ).request(`/${ASIG}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'texto', text: 'hola' }),
    });
    expect(chat.status).toBe(403);
    expect(await chat.json()).toMatchObject({ code: 'capability_denied' });
  });
});
