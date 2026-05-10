import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
};

const ASSIGNMENT_ID = '00000000-0000-0000-0000-000000000d01';
const TRIP_ID = '00000000-0000-0000-0000-000000000d02';
const TRIP_EVENT_ID = '00000000-0000-0000-0000-000000000d03';
const SHIPPER_USER_ID = '00000000-0000-0000-0000-000000000d04';

interface JoinRow {
  tripId: string;
  trackingCode: string;
  shipperUserId: string | null;
}

function makeDbStub(opts: { row?: JoinRow | null }) {
  const responses: Array<unknown[]> = [opts.row ? [opts.row] : []];
  let callIdx = 0;
  const limitFn = vi.fn(() => Promise.resolve(responses[callIdx++] ?? []));
  const whereFn = vi.fn(() => ({ limit: limitFn }));
  const innerJoinFn = vi.fn(() => ({ where: whereFn }));
  const fromFn = vi.fn(() => ({ innerJoin: innerJoinFn }));
  const selectFn = vi.fn(() => ({ from: fromFn }));
  return { db: { select: selectFn } as never };
}

describe('notifyIncidentToShipper', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('assignment no encontrado → attempted=false reason=no_assignment', async () => {
    const sendPushSpy = vi.fn();
    vi.doMock('../../src/services/web-push.js', () => ({ sendPushToUser: sendPushSpy }));
    const { notifyIncidentToShipper } = await import(
      '../../src/services/notify-incident-shipper.js'
    );
    const { db } = makeDbStub({ row: null });
    const result = await notifyIncidentToShipper({
      db,
      logger: noopLogger as never,
      assignmentId: ASSIGNMENT_ID,
      tripEventId: TRIP_EVENT_ID,
      incidentType: 'demora',
    });
    expect(result.attempted).toBe(false);
    expect(result.reason).toBe('no_assignment');
    expect(sendPushSpy).not.toHaveBeenCalled();
  });

  it('trip sin shipperUserId → attempted=false reason=no_shipper_user (sin push)', async () => {
    const sendPushSpy = vi.fn();
    vi.doMock('../../src/services/web-push.js', () => ({ sendPushToUser: sendPushSpy }));
    const { notifyIncidentToShipper } = await import(
      '../../src/services/notify-incident-shipper.js'
    );
    const { db } = makeDbStub({
      row: { tripId: TRIP_ID, trackingCode: 'BOO-X', shipperUserId: null },
    });
    const result = await notifyIncidentToShipper({
      db,
      logger: noopLogger as never,
      assignmentId: ASSIGNMENT_ID,
      tripEventId: TRIP_EVENT_ID,
      incidentType: 'accidente',
    });
    expect(result.attempted).toBe(false);
    expect(result.reason).toBe('no_shipper_user');
    expect(sendPushSpy).not.toHaveBeenCalled();
  });

  it('happy path: dispara sendPushToUser con payload correcto', async () => {
    const sendPushSpy = vi.fn().mockResolvedValue({ sent: 1, invalidated: 0, errored: 0 });
    vi.doMock('../../src/services/web-push.js', () => ({ sendPushToUser: sendPushSpy }));
    const { notifyIncidentToShipper } = await import(
      '../../src/services/notify-incident-shipper.js'
    );
    const { db } = makeDbStub({
      row: { tripId: TRIP_ID, trackingCode: 'BOO-XYZ987', shipperUserId: SHIPPER_USER_ID },
    });
    const result = await notifyIncidentToShipper({
      db,
      logger: noopLogger as never,
      assignmentId: ASSIGNMENT_ID,
      tripEventId: TRIP_EVENT_ID,
      incidentType: 'falla_mecanica',
      description: 'Pinchazo rueda trasera',
    });
    expect(result.attempted).toBe(true);
    expect(result.sent).toBe(1);
    expect(sendPushSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: SHIPPER_USER_ID,
        payload: expect.objectContaining({
          title: 'Incidente en BOO-XYZ987',
          body: expect.stringMatching(/Falla mecánica/),
          tag: `incident-${ASSIGNMENT_ID}`,
          data: expect.objectContaining({
            assignment_id: ASSIGNMENT_ID,
            message_id: TRIP_EVENT_ID,
            url: `/app/cargas/${TRIP_ID}`,
          }),
        }),
      }),
    );
  });

  it('body incluye descripción truncada a 80 chars cuando viene', async () => {
    const sendPushSpy = vi.fn().mockResolvedValue({ sent: 1, invalidated: 0, errored: 0 });
    vi.doMock('../../src/services/web-push.js', () => ({ sendPushToUser: sendPushSpy }));
    const { notifyIncidentToShipper } = await import(
      '../../src/services/notify-incident-shipper.js'
    );
    const { db } = makeDbStub({
      row: { tripId: TRIP_ID, trackingCode: 'BOO-Y', shipperUserId: SHIPPER_USER_ID },
    });
    const longDesc = 'a'.repeat(200);
    await notifyIncidentToShipper({
      db,
      logger: noopLogger as never,
      assignmentId: ASSIGNMENT_ID,
      tripEventId: TRIP_EVENT_ID,
      incidentType: 'otro',
      description: longDesc,
    });
    const call = sendPushSpy.mock.calls[0][0];
    expect(call.payload.body.length).toBeLessThanOrEqual(110);
    expect(call.payload.body).toMatch(/…$/);
  });

  it('body sin descripción usa solo el label', async () => {
    const sendPushSpy = vi.fn().mockResolvedValue({ sent: 1, invalidated: 0, errored: 0 });
    vi.doMock('../../src/services/web-push.js', () => ({ sendPushToUser: sendPushSpy }));
    const { notifyIncidentToShipper } = await import(
      '../../src/services/notify-incident-shipper.js'
    );
    const { db } = makeDbStub({
      row: { tripId: TRIP_ID, trackingCode: 'BOO-Z', shipperUserId: SHIPPER_USER_ID },
    });
    await notifyIncidentToShipper({
      db,
      logger: noopLogger as never,
      assignmentId: ASSIGNMENT_ID,
      tripEventId: TRIP_EVENT_ID,
      incidentType: 'demora',
    });
    const call = sendPushSpy.mock.calls[0][0];
    expect(call.payload.body).toBe('Demora');
  });

  it('description trim vacío → usa solo label (no " · ")', async () => {
    const sendPushSpy = vi.fn().mockResolvedValue({ sent: 1, invalidated: 0, errored: 0 });
    vi.doMock('../../src/services/web-push.js', () => ({ sendPushToUser: sendPushSpy }));
    const { notifyIncidentToShipper } = await import(
      '../../src/services/notify-incident-shipper.js'
    );
    const { db } = makeDbStub({
      row: { tripId: TRIP_ID, trackingCode: 'BOO-Z', shipperUserId: SHIPPER_USER_ID },
    });
    await notifyIncidentToShipper({
      db,
      logger: noopLogger as never,
      assignmentId: ASSIGNMENT_ID,
      tripEventId: TRIP_EVENT_ID,
      incidentType: 'accidente',
      description: '   ',
    });
    const call = sendPushSpy.mock.calls[0][0];
    expect(call.payload.body).toBe('Accidente');
  });

  it('tag = `incident-${assignmentId}` para dedupe multiple incidents same trip', async () => {
    const sendPushSpy = vi.fn().mockResolvedValue({ sent: 1, invalidated: 0, errored: 0 });
    vi.doMock('../../src/services/web-push.js', () => ({ sendPushToUser: sendPushSpy }));
    const { notifyIncidentToShipper } = await import(
      '../../src/services/notify-incident-shipper.js'
    );
    const { db } = makeDbStub({
      row: { tripId: TRIP_ID, trackingCode: 'BOO-T', shipperUserId: SHIPPER_USER_ID },
    });
    await notifyIncidentToShipper({
      db,
      logger: noopLogger as never,
      assignmentId: ASSIGNMENT_ID,
      tripEventId: TRIP_EVENT_ID,
      incidentType: 'problema_carga',
    });
    const call = sendPushSpy.mock.calls[0][0];
    expect(call.payload.tag).toBe(`incident-${ASSIGNMENT_ID}`);
  });

  it('cuando sendPushToUser tira error 0 sent + errored>0 → reason=send_failed', async () => {
    const sendPushSpy = vi.fn().mockResolvedValue({ sent: 0, invalidated: 0, errored: 2 });
    vi.doMock('../../src/services/web-push.js', () => ({ sendPushToUser: sendPushSpy }));
    const { notifyIncidentToShipper } = await import(
      '../../src/services/notify-incident-shipper.js'
    );
    const { db } = makeDbStub({
      row: { tripId: TRIP_ID, trackingCode: 'BOO-E', shipperUserId: SHIPPER_USER_ID },
    });
    const result = await notifyIncidentToShipper({
      db,
      logger: noopLogger as never,
      assignmentId: ASSIGNMENT_ID,
      tripEventId: TRIP_EVENT_ID,
      incidentType: 'demora',
    });
    expect(result.attempted).toBe(true);
    expect(result.reason).toBe('send_failed');
  });
});
