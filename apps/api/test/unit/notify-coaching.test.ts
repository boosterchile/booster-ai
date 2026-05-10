import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotifyCoachingDeps } from '../../src/services/notify-coaching.js';

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
} as unknown as NotifyCoachingDeps['logger'];

const TRIP_ID = '00000000-0000-0000-0000-000000000a01';
const EMPRESA_ID = '00000000-0000-0000-0000-000000000a02';
const OWNER_USER_ID = '00000000-0000-0000-0000-000000000a03';
const VALID_SID = 'HXabc1234567890abcdef1234567890ab';

interface TripRow {
  trackingCode: string;
}
interface MetricRow {
  score: number | null;
  nivel: string | null;
  mensaje: string | null;
  coachingWhatsappEnviadoEn: Date | null;
}
interface AssignmentRow {
  empresaId: string;
}
interface OwnerRow {
  userId: string;
  whatsappE164: string | null;
}

/**
 * Stub del DB. Las 4 queries SELECT en notify-coaching.ts comparten el
 * patron `select().from().where().limit()` excepto la cuarta (ownerJoin)
 * que es `select().from().innerJoin().where().orderBy().limit()`. Damos
 * un FIFO de respuestas ordenadas: trip, metric, assignment, owner.
 *
 * El UPDATE final usa update().set().where().returning().
 */
function makeDbStub(opts: {
  trip?: TripRow | null;
  metric?: MetricRow | null;
  assignment?: AssignmentRow | null;
  owner?: OwnerRow | null;
  /** Si .returning() devuelve 0 rows, hubo race con otro mark. */
  updateReturned?: number;
}) {
  const responses: Array<unknown[]> = [
    opts.trip === null || opts.trip === undefined ? [] : [opts.trip],
    opts.metric === null || opts.metric === undefined ? [] : [opts.metric],
    opts.assignment === null || opts.assignment === undefined ? [] : [opts.assignment],
    opts.owner === null || opts.owner === undefined ? [] : [opts.owner],
  ];
  let callIdx = 0;

  const limitFn = vi.fn(() => Promise.resolve(responses[callIdx++] ?? []));
  const orderByFn = vi.fn(() => ({ limit: limitFn }));
  const whereFn = vi.fn(() => ({ limit: limitFn, orderBy: orderByFn }));
  const innerJoinFn = vi.fn(() => ({ where: whereFn }));
  const fromFn = vi.fn(() => ({ where: whereFn, innerJoin: innerJoinFn }));
  const selectFn = vi.fn(() => ({ from: fromFn }));

  // UPDATE returning idempotency mark. tripMetrics PK es tripId.
  const returnedRows = (opts.updateReturned ?? 1) > 0 ? [{ tripId: TRIP_ID }] : [];
  const returningFn = vi.fn().mockResolvedValue(returnedRows);
  const updateWhereFn = vi.fn(() => ({ returning: returningFn }));
  const updateSetFn = vi.fn(() => ({ where: updateWhereFn }));
  const updateFn = vi.fn(() => ({ set: updateSetFn }));

  return {
    db: { select: selectFn, update: updateFn } as unknown as NotifyCoachingDeps['db'],
    spies: { selectFn, updateFn, updateSetFn, updateWhereFn, returningFn },
  };
}

function makeTwilioStub(overrides?: { sendContent?: ReturnType<typeof vi.fn> }) {
  return {
    sendText: vi.fn(),
    sendContent:
      overrides?.sendContent ??
      vi.fn().mockResolvedValue({
        sid: 'SM_test_coaching',
        status: 'queued',
        to: 'whatsapp:+56912345678',
        from: 'whatsapp:+19383365293',
        body: 'rendered template body',
        date_created: '2026-05-10T12:00:00Z',
      }),
  } as unknown as NonNullable<NotifyCoachingDeps['twilioClient']>;
}

const baseTrip = (): TripRow => ({ trackingCode: 'BOO-XYZ987' });
const baseMetric = (overrides: Partial<MetricRow> = {}): MetricRow => ({
  score: 84,
  nivel: 'bueno',
  mensaje: 'Buen viaje. Mantén distancia para anticipar frenadas.',
  coachingWhatsappEnviadoEn: null,
  ...overrides,
});
const baseAssignment = (): AssignmentRow => ({ empresaId: EMPRESA_ID });
const baseOwner = (whatsappE164: string | null = '+56912345678'): OwnerRow => ({
  userId: OWNER_USER_ID,
  whatsappE164,
});

describe('notifyCoachingToCarrier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skipea si twilioClient es null', async () => {
    const { notifyCoachingToCarrier } = await import('../../src/services/notify-coaching.js');
    const { db } = makeDbStub({});
    const result = await notifyCoachingToCarrier(
      {
        db,
        logger: noopLogger,
        twilioClient: null,
        contentSidCoaching: VALID_SID,
        webAppUrl: 'https://app.boosterchile.com',
      },
      { tripId: TRIP_ID },
    );
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('not_configured');
  });

  it('skipea si contentSidCoaching es null', async () => {
    const { notifyCoachingToCarrier } = await import('../../src/services/notify-coaching.js');
    const { db } = makeDbStub({});
    const twilio = makeTwilioStub();
    const result = await notifyCoachingToCarrier(
      {
        db,
        logger: noopLogger,
        twilioClient: twilio,
        contentSidCoaching: null,
        webAppUrl: 'https://app.boosterchile.com',
      },
      { tripId: TRIP_ID },
    );
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('not_configured');
  });

  it('skipea si trip no existe', async () => {
    const { notifyCoachingToCarrier } = await import('../../src/services/notify-coaching.js');
    const { db } = makeDbStub({ trip: null });
    const twilio = makeTwilioStub();
    const result = await notifyCoachingToCarrier(
      {
        db,
        logger: noopLogger,
        twilioClient: twilio,
        contentSidCoaching: VALID_SID,
        webAppUrl: 'https://app.boosterchile.com',
      },
      { tripId: TRIP_ID },
    );
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('trip_not_found');
    expect(twilio.sendContent).not.toHaveBeenCalled();
  });

  it('skipea si metric row no existe (trip sin Teltonika)', async () => {
    const { notifyCoachingToCarrier } = await import('../../src/services/notify-coaching.js');
    const { db } = makeDbStub({ trip: baseTrip(), metric: null });
    const twilio = makeTwilioStub();
    const result = await notifyCoachingToCarrier(
      {
        db,
        logger: noopLogger,
        twilioClient: twilio,
        contentSidCoaching: VALID_SID,
        webAppUrl: 'https://app.boosterchile.com',
      },
      { tripId: TRIP_ID },
    );
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('no_coaching_persisted');
  });

  it('skipea si coachingMensaje todavía no fue persistido', async () => {
    const { notifyCoachingToCarrier } = await import('../../src/services/notify-coaching.js');
    const { db } = makeDbStub({
      trip: baseTrip(),
      metric: baseMetric({ mensaje: null }),
    });
    const twilio = makeTwilioStub();
    const result = await notifyCoachingToCarrier(
      {
        db,
        logger: noopLogger,
        twilioClient: twilio,
        contentSidCoaching: VALID_SID,
        webAppUrl: 'https://app.boosterchile.com',
      },
      { tripId: TRIP_ID },
    );
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('no_coaching_persisted');
  });

  it('skipea si ya fue notificado (idempotencia)', async () => {
    const { notifyCoachingToCarrier } = await import('../../src/services/notify-coaching.js');
    const { db, spies } = makeDbStub({
      trip: baseTrip(),
      metric: baseMetric({
        coachingWhatsappEnviadoEn: new Date('2026-05-10T10:00:00Z'),
      }),
    });
    const twilio = makeTwilioStub();
    const result = await notifyCoachingToCarrier(
      {
        db,
        logger: noopLogger,
        twilioClient: twilio,
        contentSidCoaching: VALID_SID,
        webAppUrl: 'https://app.boosterchile.com',
      },
      { tripId: TRIP_ID },
    );
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('already_notified');
    expect(twilio.sendContent).not.toHaveBeenCalled();
    expect(spies.updateFn).not.toHaveBeenCalled();
  });

  it('skipea si trip sin assignment', async () => {
    const { notifyCoachingToCarrier } = await import('../../src/services/notify-coaching.js');
    const { db } = makeDbStub({
      trip: baseTrip(),
      metric: baseMetric(),
      assignment: null,
    });
    const twilio = makeTwilioStub();
    const result = await notifyCoachingToCarrier(
      {
        db,
        logger: noopLogger,
        twilioClient: twilio,
        contentSidCoaching: VALID_SID,
        webAppUrl: 'https://app.boosterchile.com',
      },
      { tripId: TRIP_ID },
    );
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('no_assignment');
  });

  it('skipea si empresa transportista sin dueño activo', async () => {
    const { notifyCoachingToCarrier } = await import('../../src/services/notify-coaching.js');
    const { db } = makeDbStub({
      trip: baseTrip(),
      metric: baseMetric(),
      assignment: baseAssignment(),
      owner: null,
    });
    const twilio = makeTwilioStub();
    const result = await notifyCoachingToCarrier(
      {
        db,
        logger: noopLogger,
        twilioClient: twilio,
        contentSidCoaching: VALID_SID,
        webAppUrl: 'https://app.boosterchile.com',
      },
      { tripId: TRIP_ID },
    );
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('no_owner');
  });

  it('skipea si dueño sin whatsapp_e164', async () => {
    const { notifyCoachingToCarrier } = await import('../../src/services/notify-coaching.js');
    const { db } = makeDbStub({
      trip: baseTrip(),
      metric: baseMetric(),
      assignment: baseAssignment(),
      owner: baseOwner(null),
    });
    const twilio = makeTwilioStub();
    const result = await notifyCoachingToCarrier(
      {
        db,
        logger: noopLogger,
        twilioClient: twilio,
        contentSidCoaching: VALID_SID,
        webAppUrl: 'https://app.boosterchile.com',
      },
      { tripId: TRIP_ID },
    );
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('no_whatsapp');
    expect(twilio.sendContent).not.toHaveBeenCalled();
  });

  it('envía con variables correctas y registra el twilioMessageSid', async () => {
    const { notifyCoachingToCarrier } = await import('../../src/services/notify-coaching.js');
    const { db, spies } = makeDbStub({
      trip: baseTrip(),
      metric: baseMetric(),
      assignment: baseAssignment(),
      owner: baseOwner(),
    });
    const sendContent = vi.fn().mockResolvedValue({
      sid: 'SM_real',
      status: 'queued',
      to: 'whatsapp:+56912345678',
      from: 'whatsapp:+19383365293',
      body: '...',
      date_created: '2026-05-10T12:00:00Z',
    });
    const twilio = makeTwilioStub({ sendContent });
    const result = await notifyCoachingToCarrier(
      {
        db,
        logger: noopLogger,
        twilioClient: twilio,
        contentSidCoaching: VALID_SID,
        webAppUrl: 'https://app.boosterchile.com',
      },
      { tripId: TRIP_ID },
    );
    expect(result.skipped).toBe(false);
    expect(result.twilioMessageSid).toBe('SM_real');
    expect(sendContent).toHaveBeenCalledWith({
      to: '+56912345678',
      contentSid: VALID_SID,
      contentVariables: {
        '1': 'BOO-XYZ987',
        '2': '84/100 · Bueno',
        '3': 'Buen viaje. Mantén distancia para anticipar frenadas.',
        '4': `https://app.boosterchile.com/app/viajes/${TRIP_ID}`,
      },
    });
    // Confirma que el UPDATE de mark se ejecutó (pre-send guard).
    expect(spies.updateFn).toHaveBeenCalledTimes(1);
    expect(spies.returningFn).toHaveBeenCalledTimes(1);
  });

  it('skipea si race: otro mark concurrente ganó (returning vacío)', async () => {
    const { notifyCoachingToCarrier } = await import('../../src/services/notify-coaching.js');
    const { db } = makeDbStub({
      trip: baseTrip(),
      metric: baseMetric(),
      assignment: baseAssignment(),
      owner: baseOwner(),
      updateReturned: 0,
    });
    const twilio = makeTwilioStub();
    const result = await notifyCoachingToCarrier(
      {
        db,
        logger: noopLogger,
        twilioClient: twilio,
        contentSidCoaching: VALID_SID,
        webAppUrl: 'https://app.boosterchile.com',
      },
      { tripId: TRIP_ID },
    );
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('already_notified');
    expect(twilio.sendContent).not.toHaveBeenCalled();
  });
});
