import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotifyTrackingLinkDeps } from '../../src/services/notify-tracking-link.js';

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
} as unknown as NotifyTrackingLinkDeps['logger'];

const ASSIGNMENT_ID = '00000000-0000-0000-0000-000000000b01';
const VALID_SID = 'HXac1ef21ed9423258a2c38dad02f31e41';
const TOKEN = '550e8400-e29b-41d4-a716-446655440000';

interface JoinRow {
  assignmentId: string;
  publicToken: string | null;
  trackingCode: string;
  originRegion: string | null;
  destRegion: string | null;
  shipperUserId: string | null;
  shipperWhatsapp: string | null;
}

function makeDbStub(opts: { row?: JoinRow | null }) {
  const responses: Array<unknown[]> = [opts.row ? [opts.row] : []];
  let callIdx = 0;
  const limitFn = vi.fn(() => Promise.resolve(responses[callIdx++] ?? []));
  const whereFn = vi.fn(() => ({ limit: limitFn }));
  const leftJoinFn = vi.fn(() => ({ where: whereFn }));
  const innerJoinFn = vi.fn(() => ({ leftJoin: leftJoinFn, where: whereFn }));
  const fromFn = vi.fn(() => ({ innerJoin: innerJoinFn, where: whereFn }));
  const selectFn = vi.fn(() => ({ from: fromFn }));
  return { db: { select: selectFn } as unknown as NotifyTrackingLinkDeps['db'] };
}

function makeTwilioStub(overrides?: { sendContent?: ReturnType<typeof vi.fn> }) {
  return {
    sendText: vi.fn(),
    sendContent:
      overrides?.sendContent ??
      vi.fn().mockResolvedValue({
        sid: 'SM_test_tracking',
        status: 'queued',
        to: 'whatsapp:+56912345678',
        from: 'whatsapp:+19383365293',
        body: 'rendered template body',
        date_created: '2026-05-10T20:00:00Z',
      }),
  } as unknown as NonNullable<NotifyTrackingLinkDeps['twilioClient']>;
}

const baseRow = (overrides: Partial<JoinRow> = {}): JoinRow => ({
  assignmentId: ASSIGNMENT_ID,
  publicToken: TOKEN,
  trackingCode: 'BOO-XYZ987',
  originRegion: 'XIII',
  destRegion: 'IV',
  shipperUserId: '00000000-0000-0000-0000-000000000b02',
  shipperWhatsapp: '+56912345678',
  ...overrides,
});

describe('notifyTrackingLinkAtAssignment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skipea si twilioClient es null', async () => {
    const { notifyTrackingLinkAtAssignment } = await import(
      '../../src/services/notify-tracking-link.js'
    );
    const { db } = makeDbStub({});
    const result = await notifyTrackingLinkAtAssignment(
      {
        db,
        logger: noopLogger,
        twilioClient: null,
        contentSidTracking: VALID_SID,
      },
      { assignmentId: ASSIGNMENT_ID },
    );
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('not_configured');
  });

  it('skipea si contentSidTracking es null', async () => {
    const { notifyTrackingLinkAtAssignment } = await import(
      '../../src/services/notify-tracking-link.js'
    );
    const { db } = makeDbStub({});
    const result = await notifyTrackingLinkAtAssignment(
      {
        db,
        logger: noopLogger,
        twilioClient: makeTwilioStub(),
        contentSidTracking: null,
      },
      { assignmentId: ASSIGNMENT_ID },
    );
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('not_configured');
  });

  it('skipea si assignment no existe', async () => {
    const { notifyTrackingLinkAtAssignment } = await import(
      '../../src/services/notify-tracking-link.js'
    );
    const { db } = makeDbStub({ row: null });
    const result = await notifyTrackingLinkAtAssignment(
      {
        db,
        logger: noopLogger,
        twilioClient: makeTwilioStub(),
        contentSidTracking: VALID_SID,
      },
      { assignmentId: ASSIGNMENT_ID },
    );
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('assignment_not_found');
  });

  it('skipea si publicToken es null (assignment pre-Phase-5)', async () => {
    const { notifyTrackingLinkAtAssignment } = await import(
      '../../src/services/notify-tracking-link.js'
    );
    const { db } = makeDbStub({ row: baseRow({ publicToken: null }) });
    const result = await notifyTrackingLinkAtAssignment(
      {
        db,
        logger: noopLogger,
        twilioClient: makeTwilioStub(),
        contentSidTracking: VALID_SID,
      },
      { assignmentId: ASSIGNMENT_ID },
    );
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('no_token');
  });

  it('skipea si shipperUserId null (trip sin createdByUserId)', async () => {
    const { notifyTrackingLinkAtAssignment } = await import(
      '../../src/services/notify-tracking-link.js'
    );
    const { db } = makeDbStub({ row: baseRow({ shipperUserId: null }) });
    const result = await notifyTrackingLinkAtAssignment(
      {
        db,
        logger: noopLogger,
        twilioClient: makeTwilioStub(),
        contentSidTracking: VALID_SID,
      },
      { assignmentId: ASSIGNMENT_ID },
    );
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('no_owner');
  });

  it('skipea si shipper sin whatsapp_e164', async () => {
    const { notifyTrackingLinkAtAssignment } = await import(
      '../../src/services/notify-tracking-link.js'
    );
    const { db } = makeDbStub({ row: baseRow({ shipperWhatsapp: null }) });
    const result = await notifyTrackingLinkAtAssignment(
      {
        db,
        logger: noopLogger,
        twilioClient: makeTwilioStub(),
        contentSidTracking: VALID_SID,
      },
      { assignmentId: ASSIGNMENT_ID },
    );
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('no_whatsapp');
  });

  it('envía con variables correctas (1=tracking_code, 2=origen, 3=destino, 4=token)', async () => {
    const { notifyTrackingLinkAtAssignment } = await import(
      '../../src/services/notify-tracking-link.js'
    );
    const { db } = makeDbStub({ row: baseRow() });
    const sendContent = vi.fn().mockResolvedValue({
      sid: 'SM_real',
      status: 'queued',
      to: 'whatsapp:+56912345678',
      from: 'whatsapp:+19383365293',
      body: '...',
      date_created: '2026-05-10T20:00:00Z',
    });
    const twilio = makeTwilioStub({ sendContent });
    const result = await notifyTrackingLinkAtAssignment(
      {
        db,
        logger: noopLogger,
        twilioClient: twilio,
        contentSidTracking: VALID_SID,
      },
      { assignmentId: ASSIGNMENT_ID },
    );
    expect(result.skipped).toBe(false);
    expect(result.twilioMessageSid).toBe('SM_real');
    expect(sendContent).toHaveBeenCalledWith({
      to: '+56912345678',
      contentSid: VALID_SID,
      contentVariables: {
        '1': 'BOO-XYZ987',
        '2': 'Metropolitana',
        '3': 'Coquimbo',
        '4': TOKEN,
      },
    });
  });

  it('regiones unknown se mapean a placeholder em-dash', async () => {
    const { notifyTrackingLinkAtAssignment } = await import(
      '../../src/services/notify-tracking-link.js'
    );
    const { db } = makeDbStub({
      row: baseRow({ originRegion: null, destRegion: 'XX' }),
    });
    const sendContent = vi.fn().mockResolvedValue({
      sid: 'SM_x',
      status: 'queued',
      to: 'x',
      from: 'x',
      body: '',
      date_created: 'x',
    });
    const twilio = makeTwilioStub({ sendContent });
    await notifyTrackingLinkAtAssignment(
      {
        db,
        logger: noopLogger,
        twilioClient: twilio,
        contentSidTracking: VALID_SID,
      },
      { assignmentId: ASSIGNMENT_ID },
    );
    const call = sendContent.mock.calls[0]?.[0];
    expect(call.contentVariables['2']).toBe('—'); // null → em-dash
    expect(call.contentVariables['3']).toBe('XX'); // unknown code → raw fallback
  });
});
