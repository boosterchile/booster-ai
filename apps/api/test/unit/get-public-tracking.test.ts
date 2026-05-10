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
    pings?: Array<{
      timestamp: Date;
      latitude: string | null;
      longitude: string | null;
      speedKmh: number | null;
    }>;
  }) {
    const responses: Array<unknown[]> = [
      opts.assignmentRow ? [opts.assignmentRow] : [],
      opts.pings ?? [],
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

  it('found sin pings → position null + progress null', async () => {
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
      pings: [],
    });
    const result = await getPublicTracking({ db, logger: noopLogger, token: VALID_TOKEN });
    expect(result.status).toBe('found');
    if (result.status === 'found') {
      expect(result.trip.tracking_code).toBe('BOO-XYZ987');
      expect(result.trip.status).toBe('en_proceso');
      expect(result.vehicle.plate_partial).toBe('***AS12');
      expect(result.position).toBeNull();
      expect(result.progress.avg_speed_kmh_last_15min).toBeNull();
      expect(result.progress.last_position_age_seconds).toBeNull();
      expect(result.eta_minutes).toBeNull();
    }
  });

  it('found con pings recientes → position numérica + progress poblado', async () => {
    const { getPublicTracking } = await import('../../src/services/get-public-tracking.js');
    // Timestamps relativos a "ahora" — el service usa Date.now() para el
    // cutoff de la ventana 15min; si fijamos timestamps en un date
    // estático del pasado, caen fuera de la ventana en vez de la entrada.
    const now = Date.now();
    const ts = new Date(now - 60_000); // 1 min atrás → IN window
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
      pings: [
        // DESC: el primero es el más reciente.
        { timestamp: ts, latitude: '-33.4172', longitude: '-70.6063', speedKmh: 65 },
        {
          timestamp: new Date(now - 5 * 60_000), // 5 min atrás → IN
          latitude: '-33.4',
          longitude: '-70.6',
          speedKmh: 60,
        },
        {
          timestamp: new Date(now - 10 * 60_000), // 10 min atrás → IN
          latitude: '-33.39',
          longitude: '-70.59',
          speedKmh: 70,
        },
      ],
    });
    const result = await getPublicTracking({ db, logger: noopLogger, token: VALID_TOKEN });
    expect(result.status).toBe('found');
    if (result.status === 'found' && result.position) {
      expect(result.position.latitude).toBeCloseTo(-33.4172, 4);
      expect(result.position.longitude).toBeCloseTo(-70.6063, 4);
      expect(result.position.speed_kmh).toBe(65);
      expect(result.position.timestamp).toBe(ts.toISOString());
      // progress: avg de [65, 60, 70] = 65.0
      expect(result.progress.avg_speed_kmh_last_15min).toBeCloseTo(65, 1);
      // last_position_age_seconds debería ser ~60 ± slack del runtime.
      expect(result.progress.last_position_age_seconds).toBeGreaterThanOrEqual(59);
      expect(result.progress.last_position_age_seconds).toBeLessThanOrEqual(62);
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
      pings: [],
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

describe('computeProgress', () => {
  const NOW_MS = new Date('2026-05-10T15:00:00Z').getTime();

  it('sin pings → todo null', async () => {
    const { computeProgress } = await import('../../src/services/get-public-tracking.js');
    expect(computeProgress({ pings: [], nowMs: NOW_MS })).toEqual({
      avg_speed_kmh_last_15min: null,
      last_position_age_seconds: null,
    });
  });

  it('1 ping → last_position_age computed, avg_speed null (necesita ≥2)', async () => {
    const { computeProgress } = await import('../../src/services/get-public-tracking.js');
    const result = computeProgress({
      pings: [{ timestamp: new Date(NOW_MS - 30_000), speedKmh: 50 }],
      nowMs: NOW_MS,
    });
    expect(result.last_position_age_seconds).toBe(30);
    expect(result.avg_speed_kmh_last_15min).toBeNull();
  });

  it('2+ pings con speeds positivos → avg_speed redondeado a 1 decimal', async () => {
    const { computeProgress } = await import('../../src/services/get-public-tracking.js');
    const result = computeProgress({
      pings: [
        { timestamp: new Date(NOW_MS - 60_000), speedKmh: 60 },
        { timestamp: new Date(NOW_MS - 120_000), speedKmh: 70 },
        { timestamp: new Date(NOW_MS - 180_000), speedKmh: 80 },
      ],
      nowMs: NOW_MS,
    });
    expect(result.avg_speed_kmh_last_15min).toBeCloseTo(70, 1);
    expect(result.last_position_age_seconds).toBe(60);
  });

  it('todos los speeds = 0 → avg_speed null (ambiguo: parado vs GPS roto)', async () => {
    const { computeProgress } = await import('../../src/services/get-public-tracking.js');
    const result = computeProgress({
      pings: [
        { timestamp: new Date(NOW_MS - 60_000), speedKmh: 0 },
        { timestamp: new Date(NOW_MS - 120_000), speedKmh: 0 },
      ],
      nowMs: NOW_MS,
    });
    expect(result.avg_speed_kmh_last_15min).toBeNull();
  });

  it('pings con speedKmh=null se excluyen del avg', async () => {
    const { computeProgress } = await import('../../src/services/get-public-tracking.js');
    const result = computeProgress({
      pings: [
        { timestamp: new Date(NOW_MS - 60_000), speedKmh: null },
        { timestamp: new Date(NOW_MS - 120_000), speedKmh: 60 },
        { timestamp: new Date(NOW_MS - 180_000), speedKmh: 80 },
      ],
      nowMs: NOW_MS,
    });
    expect(result.avg_speed_kmh_last_15min).toBeCloseTo(70, 1);
  });

  it('pings fuera de ventana 15min se excluyen del avg', async () => {
    const { computeProgress } = await import('../../src/services/get-public-tracking.js');
    const result = computeProgress({
      pings: [
        { timestamp: new Date(NOW_MS - 60_000), speedKmh: 60 }, // 1 min — IN
        { timestamp: new Date(NOW_MS - 16 * 60_000), speedKmh: 200 }, // 16 min — OUT
        { timestamp: new Date(NOW_MS - 25 * 60_000), speedKmh: 200 }, // 25 min — OUT
      ],
      nowMs: NOW_MS,
    });
    // Solo el primero está en ventana; con <2 → avg null.
    expect(result.avg_speed_kmh_last_15min).toBeNull();
    // Pero last_position_age usa el más reciente.
    expect(result.last_position_age_seconds).toBe(60);
  });

  it('last_position_age clamped a 0 si timestamp futuro (clock skew)', async () => {
    const { computeProgress } = await import('../../src/services/get-public-tracking.js');
    const result = computeProgress({
      pings: [{ timestamp: new Date(NOW_MS + 30_000), speedKmh: 50 }], // 30s futuro
      nowMs: NOW_MS,
    });
    expect(result.last_position_age_seconds).toBe(0);
  });
});
