import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

type MeRoutesOpts = Parameters<typeof import('../../src/routes/me.js').createMeRoutes>[0];

const noop = () => undefined;
const noopLogger = {
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  fatal: noop,
  child: () => noopLogger,
} as unknown as MeRoutesOpts['logger'];

const ROW = {
  assignmentId: 'asg-1',
  assignmentStatus: 'asignado',
  empresaId: 'emp-1',
  empresaLegalName: 'Transportes Van Oosterwyk',
  acceptedAt: new Date('2026-08-17T19:00:00Z'),
  pickedUpAt: null,
  agreedPriceClp: 850000,
  tripId: 'trip-1',
  trackingCode: 'BOO-BKAXIK',
  tripStatus: 'asignado',
  originAddressRaw: 'Av. Américo Vespucio 1501, Pudahuel',
  originRegionCode: 'XIII',
  destinationAddressRaw: 'Ruta 5 Norte km 470, La Serena',
  destinationRegionCode: 'IV',
  cargoType: 'carga_seca',
  cargoWeightKg: 8000,
  pickupWindowStart: null,
  pickupWindowEnd: null,
  vehicleId: 'veh-1',
  vehiclePlate: 'JLKT54',
  vehicleTeltonikaImei: '860693088543278',
};

/**
 * Dos SELECT en orden: el del usuario (from → where → limit) y el de los
 * assignments (from → innerJoin → leftJoin → leftJoin → where → orderBy).
 */
function makeDbStub(rows: Record<string, unknown>[]): MeRoutesOpts['db'] {
  let call = 0;
  const selectFn = vi.fn(() => {
    call += 1;
    if (call === 1) {
      return {
        from: () => ({ where: () => ({ limit: vi.fn().mockResolvedValue([{ id: 'u-1' }]) }) }),
      };
    }
    const chain = {
      from: () => chain,
      innerJoin: () => chain,
      leftJoin: () => chain,
      where: () => chain,
      orderBy: () => Promise.resolve(rows),
    };
    return chain;
  });
  return { select: selectFn } as unknown as MeRoutesOpts['db'];
}

async function buildApp(db: MeRoutesOpts['db']) {
  const { createMeRoutes } = await import('../../src/routes/me.js');
  const app = new Hono();
  app.use('/me/*', async (c, next) => {
    c.set('firebaseClaims', {
      uid: 'fb-uid',
      email: 'fvp@live.cl',
      emailVerified: true,
      name: undefined,
      picture: undefined,
      custom: {},
    });
    await next();
  });
  app.route('/me', createMeRoutes({ db, logger: noopLogger }));
  return app;
}

type Resp = {
  assignments: Array<{
    vehicle: { id: string; plate: string | null; has_teltonika: boolean } | null;
  }>;
};

describe('GET /me/assignments — vehicle.has_teltonika (tarjeta guiada del conductor)', () => {
  // La tarjeta decide si el teléfono debe reportar posición o si el camión ya
  // lo hace solo. Sin este campo la PWA mostraba el botón de GPS siempre.
  it('vehículo con IMEI Teltonika → has_teltonika: true', async () => {
    const app = await buildApp(makeDbStub([ROW]));
    const res = await app.request('/me/assignments');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Resp;
    expect(body.assignments[0]?.vehicle).toEqual({
      id: 'veh-1',
      plate: 'JLKT54',
      has_teltonika: true,
    });
  });

  it('vehículo sin IMEI → has_teltonika: false', async () => {
    const app = await buildApp(
      makeDbStub([{ ...ROW, vehiclePlate: 'KFHC70', vehicleTeltonikaImei: null }]),
    );
    const body = (await (await app.request('/me/assignments')).json()) as Resp;
    expect(body.assignments[0]?.vehicle).toEqual({
      id: 'veh-1',
      plate: 'KFHC70',
      has_teltonika: false,
    });
  });

  it('sin vehículo asignado → vehicle null', async () => {
    const app = await buildApp(
      makeDbStub([{ ...ROW, vehicleId: null, vehiclePlate: null, vehicleTeltonikaImei: null }]),
    );
    const body = (await (await app.request('/me/assignments')).json()) as Resp;
    expect(body.assignments[0]?.vehicle).toBeNull();
  });
});
