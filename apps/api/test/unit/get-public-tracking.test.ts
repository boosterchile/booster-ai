import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { isUuidLike, maskPlate } from '../../src/services/get-public-tracking.js';

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.SERVICE_NAME = 'booster-ai-api';
  process.env.SERVICE_VERSION = '0.0.0-test';
  process.env.LOG_LEVEL = 'error';
  process.env.GOOGLE_CLOUD_PROJECT = 'test';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  process.env.REDIS_HOST = 'localhost';
  process.env.CORS_ALLOWED_ORIGINS = 'http://localhost:5173';
  process.env.FIREBASE_PROJECT_ID = 'test';
  process.env.API_AUDIENCE = 'https://api.boosterchile.com';
  process.env.ALLOWED_CALLER_SA = 'caller@booster-ai.iam.gserviceaccount.com';
});

const noop = (): void => undefined;
const noopLogger = {
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  fatal: noop,
  child: () => noopLogger,
} as unknown as Parameters<
  typeof import('../../src/services/get-public-tracking.js').getPublicTracking
>[0]['logger'];

const VALID_TOKEN = '550e8400-e29b-41d4-a716-446655440000';

describe('isUuidLike', () => {
  it('UUID v4 válido → true', () => {
    expect(isUuidLike(VALID_TOKEN)).toBe(true);
  });

  it('UUID v1 también pasa (el regex acepta cualquier hex 8-4-4-4-12)', () => {
    expect(isUuidLike('00000000-0000-1000-8000-000000000000')).toBe(true);
  });

  it('case-insensitive', () => {
    expect(isUuidLike('550E8400-E29B-41D4-A716-446655440000')).toBe(true);
  });

  it('sin guiones → false', () => {
    expect(isUuidLike('550e8400e29b41d4a716446655440000')).toBe(false);
  });

  it('chars no-hex → false', () => {
    expect(isUuidLike('zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz')).toBe(false);
  });

  it('strings random → false', () => {
    expect(isUuidLike('not-a-token')).toBe(false);
    expect(isUuidLike('')).toBe(false);
    expect(isUuidLike('hello world')).toBe(false);
  });

  it('SQL injection attempt → false (no pasa el regex)', () => {
    expect(isUuidLike("' OR 1=1 --")).toBe(false);
  });
});

describe('maskPlate', () => {
  it('plate típica chilena XXNN-NN → enmascara prefijo', () => {
    expect(maskPlate('GR-AS12')).toBe('***AS12');
  });

  it('plate sin guion ni espacios', () => {
    expect(maskPlate('GRAS12')).toBe('**AS12');
  });

  it('plate corta (≤4 chars) NO enmascara — fallback', () => {
    expect(maskPlate('AB12')).toBe('AB12');
    expect(maskPlate('AB')).toBe('AB');
  });

  it('case insensitive normaliza a uppercase', () => {
    expect(maskPlate('gras12')).toBe('**AS12');
  });

  it('strip de espacios internos', () => {
    expect(maskPlate('GR AS 12')).toBe('**AS12');
  });
});

describe('getPublicTracking', () => {
  /**
   * Stub del DB con dos selects en cadena: assignment+trip+vehicle, luego
   * telemetry points. Ambos usan select().from().*.where().limit().
   * El segundo además tiene innerJoin / orderBy.
   */
  function makeDbStub(opts: {
    assignmentRow?: {
      assignmentId: string;
      tripStatus: string;
      trackingCode: string;
      originAddr: string;
      destAddr: string;
      cargoType: string;
      vehicleId: string;
      vehicleType: string;
      vehiclePlate: string;
    } | null;
    positionRow?: {
      timestamp: Date;
      latitude: string | null;
      longitude: string | null;
      speedKmh: number | null;
    } | null;
  }) {
    const responses: Array<unknown[]> = [
      opts.assignmentRow ? [opts.assignmentRow] : [],
      opts.positionRow ? [opts.positionRow] : [],
    ];
    let callIdx = 0;

    const limitFn = vi.fn(() => Promise.resolve(responses[callIdx++] ?? []));
    const orderByFn = vi.fn(() => ({ limit: limitFn }));
    const whereFn = vi.fn(() => ({ limit: limitFn, orderBy: orderByFn }));
    const innerJoin2 = vi.fn(() => ({ where: whereFn, innerJoin: () => ({ where: whereFn }) }));
    const innerJoin1 = vi.fn(() => ({ innerJoin: innerJoin2, where: whereFn }));
    const fromFn = vi.fn(() => ({ innerJoin: innerJoin1, where: whereFn }));
    const selectFn = vi.fn(() => ({ from: fromFn }));

    return { db: { select: selectFn } as never };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('token con formato inválido → not_found sin pegar DB', async () => {
    const { getPublicTracking } = await import('../../src/services/get-public-tracking.js');
    const { db } = makeDbStub({});
    const result = await getPublicTracking({ db, logger: noopLogger, token: 'not-a-token' });
    expect(result.status).toBe('not_found');
  });

  it('SQL injection attempt → not_found (regex defensa)', async () => {
    const { getPublicTracking } = await import('../../src/services/get-public-tracking.js');
    const { db } = makeDbStub({});
    const result = await getPublicTracking({
      db,
      logger: noopLogger,
      token: "' OR 1=1 --",
    });
    expect(result.status).toBe('not_found');
  });

  it('token válido pero no existe en DB → not_found', async () => {
    const { getPublicTracking } = await import('../../src/services/get-public-tracking.js');
    const { db } = makeDbStub({ assignmentRow: null });
    const result = await getPublicTracking({ db, logger: noopLogger, token: VALID_TOKEN });
    expect(result.status).toBe('not_found');
  });

  it('found con sin posición reciente → response sin position', async () => {
    const { getPublicTracking } = await import('../../src/services/get-public-tracking.js');
    const { db } = makeDbStub({
      assignmentRow: {
        assignmentId: 'a1',
        tripStatus: 'en_proceso',
        trackingCode: 'BOO-XYZ987',
        originAddr: 'Av. Apoquindo 123, Las Condes',
        destAddr: 'Calle Coquimbo 45, La Serena',
        cargoType: 'carga_seca',
        vehicleId: 'v1',
        vehicleType: 'camion_3_4',
        vehiclePlate: 'GR-AS12',
      },
      positionRow: null,
    });
    const result = await getPublicTracking({ db, logger: noopLogger, token: VALID_TOKEN });
    expect(result.status).toBe('found');
    if (result.status === 'found') {
      expect(result.trip.tracking_code).toBe('BOO-XYZ987');
      expect(result.trip.status).toBe('en_proceso');
      expect(result.vehicle.plate_partial).toBe('***AS12');
      expect(result.position).toBeNull();
      expect(result.eta_minutes).toBeNull();
    }
  });

  it('found con posición reciente → response con position numérica', async () => {
    const { getPublicTracking } = await import('../../src/services/get-public-tracking.js');
    const ts = new Date('2026-05-10T15:00:00Z');
    const { db } = makeDbStub({
      assignmentRow: {
        assignmentId: 'a1',
        tripStatus: 'en_proceso',
        trackingCode: 'BOO-XYZ987',
        originAddr: 'origen',
        destAddr: 'destino',
        cargoType: 'carga_seca',
        vehicleId: 'v1',
        vehicleType: 'camion_3_4',
        vehiclePlate: 'GR-AS12',
      },
      positionRow: {
        timestamp: ts,
        latitude: '-33.4172',
        longitude: '-70.6063',
        speedKmh: 65,
      },
    });
    const result = await getPublicTracking({ db, logger: noopLogger, token: VALID_TOKEN });
    expect(result.status).toBe('found');
    if (result.status === 'found' && result.position) {
      expect(result.position.latitude).toBeCloseTo(-33.4172, 4);
      expect(result.position.longitude).toBeCloseTo(-70.6063, 4);
      expect(result.position.speed_kmh).toBe(65);
      expect(result.position.timestamp).toBe(ts.toISOString());
    }
  });

  it('NO expone vehiclePlate completa — solo enmascarada', async () => {
    const { getPublicTracking } = await import('../../src/services/get-public-tracking.js');
    const { db } = makeDbStub({
      assignmentRow: {
        assignmentId: 'a1',
        tripStatus: 'asignado',
        trackingCode: 'BOO-1',
        originAddr: 'A',
        destAddr: 'B',
        cargoType: 'carga_seca',
        vehicleId: 'v1',
        vehicleType: 'camion_3_4',
        vehiclePlate: 'TOPSECRET99',
      },
      positionRow: null,
    });
    const result = await getPublicTracking({ db, logger: noopLogger, token: VALID_TOKEN });
    expect(result.status).toBe('found');
    if (result.status === 'found') {
      // 11 chars TOPSECRET99 → 7 estrellas + ET99 (últimos 4)
      expect(result.vehicle.plate_partial).toBe('*******ET99');
      expect(result.vehicle.plate_partial).not.toContain('TOPSECRET');
    }
  });
});
