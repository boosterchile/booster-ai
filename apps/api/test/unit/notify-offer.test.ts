import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotifyOfferDeps } from '../../src/services/notify-offer.js';

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

const noopLogger = {
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  child: () => noopLogger,
} as unknown as NotifyOfferDeps['logger'];

const OFFER_ID = '00000000-0000-0000-0000-000000000001';
const TRIP_ID = '00000000-0000-0000-0000-000000000002';
const EMPRESA_ID = '00000000-0000-0000-0000-000000000003';
const OWNER_USER_ID = '00000000-0000-0000-0000-000000000004';

interface OfferJoin {
  offer: {
    id: string;
    tripId: string;
    empresaId: string;
    proposedPriceClp: number;
    notifiedAt: Date | null;
  };
  trip: {
    trackingCode: string;
    originRegionCode: string | null;
    destinationRegionCode: string | null;
  };
  empresa: { id: string; legalName: string };
}

interface OwnerJoin {
  user: { id: string; whatsappE164: string | null };
}

/**
 * Stub del DB con dos joins distintos: el SELECT de offer (con joins a
 * trip+empresa) y el SELECT de owner (memberships join users). Ambos
 * comparten la cadena `select().from(...).innerJoin().innerJoin().where().limit()`
 * pero retornan shapes diferentes — controlamos cada llamada con un
 * arreglo de respuestas en orden FIFO.
 */
function makeDbStub(opts: {
  offerJoin?: OfferJoin | null;
  ownerJoin?: OwnerJoin | null;
}) {
  const responses: Array<unknown[]> = [
    opts.offerJoin === null || opts.offerJoin === undefined ? [] : [opts.offerJoin],
    opts.ownerJoin === null || opts.ownerJoin === undefined ? [] : [opts.ownerJoin],
  ];
  let callIdx = 0;

  const limitFn = vi.fn(() => Promise.resolve(responses[callIdx++] ?? []));
  // En la cadena del SELECT de owner usamos orderBy → limit. La cadena del
  // offer es directamente where → limit. Ambas se modelan con un objeto
  // que expone ambos métodos.
  const orderByFn = vi.fn(() => ({ limit: limitFn }));
  const whereFn = vi.fn(() => ({ limit: limitFn, orderBy: orderByFn }));
  const innerJoin2 = vi.fn(() => ({ where: whereFn }));
  const innerJoin1 = vi.fn(() => ({ innerJoin: innerJoin2, where: whereFn }));
  const fromFn = vi.fn(() => ({ innerJoin: innerJoin1 }));
  const selectFn = vi.fn(() => ({ from: fromFn }));

  const updateWhereFn = vi.fn().mockResolvedValue(undefined);
  const updateSetFn = vi.fn(() => ({ where: updateWhereFn }));
  const updateFn = vi.fn(() => ({ set: updateSetFn }));

  return {
    db: { select: selectFn, update: updateFn } as unknown as NotifyOfferDeps['db'],
    spies: { selectFn, updateFn, updateSetFn, updateWhereFn },
  };
}

function makeTwilioStub(overrides?: { sendContent?: ReturnType<typeof vi.fn> }) {
  return {
    sendText: vi.fn(),
    sendContent:
      overrides?.sendContent ??
      vi.fn().mockResolvedValue({
        sid: 'SM_test_notify',
        status: 'queued',
        to: 'whatsapp:+56912345678',
        from: 'whatsapp:+19383365293',
        body: 'Hola, llegó una nueva oferta...',
        date_created: '2026-05-01T12:00:00Z',
      }),
  } as unknown as NonNullable<NotifyOfferDeps['twilioClient']>;
}

function baseOfferJoin(notifiedAt: Date | null = null): OfferJoin {
  return {
    offer: {
      id: OFFER_ID,
      tripId: TRIP_ID,
      empresaId: EMPRESA_ID,
      proposedPriceClp: 850000,
      notifiedAt,
    },
    trip: {
      trackingCode: 'BOO-ABC123',
      originRegionCode: 'XIII',
      destinationRegionCode: 'VIII',
    },
    empresa: { id: EMPRESA_ID, legalName: 'Carrier SpA' },
  };
}

function baseOwnerJoin(whatsappE164: string | null = '+56912345678'): OwnerJoin {
  return {
    user: { id: OWNER_USER_ID, whatsappE164 },
  };
}

describe('notifyOfferToCarrier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skipea si twilioClient es null', async () => {
    const { notifyOfferToCarrier } = await import('../../src/services/notify-offer.js');
    const { db } = makeDbStub({});
    const result = await notifyOfferToCarrier(
      {
        db,
        logger: noopLogger,
        twilioClient: null,
        contentSidOfferNew: 'HXabc',
        webAppUrl: 'https://app.boosterchile.com',
      },
      { offerId: OFFER_ID },
    );
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('not_configured');
  });

  it('skipea si contentSidOfferNew es null', async () => {
    const { notifyOfferToCarrier } = await import('../../src/services/notify-offer.js');
    const { db } = makeDbStub({});
    const twilio = makeTwilioStub();
    const result = await notifyOfferToCarrier(
      {
        db,
        logger: noopLogger,
        twilioClient: twilio,
        contentSidOfferNew: null,
        webAppUrl: 'https://app.boosterchile.com',
      },
      { offerId: OFFER_ID },
    );
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('not_configured');
  });

  it('skipea si la oferta no existe', async () => {
    const { notifyOfferToCarrier } = await import('../../src/services/notify-offer.js');
    const { db } = makeDbStub({ offerJoin: null });
    const twilio = makeTwilioStub();
    const result = await notifyOfferToCarrier(
      {
        db,
        logger: noopLogger,
        twilioClient: twilio,
        contentSidOfferNew: 'HXabc1234567890abcdef1234567890ab',
        webAppUrl: 'https://app.boosterchile.com',
      },
      { offerId: OFFER_ID },
    );
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('offer_not_found');
  });

  it('skipea si la oferta ya fue notificada', async () => {
    const { notifyOfferToCarrier } = await import('../../src/services/notify-offer.js');
    const alreadyNotified = baseOfferJoin(new Date('2026-05-01T11:00:00Z'));
    const { db, spies } = makeDbStub({ offerJoin: alreadyNotified });
    const twilio = makeTwilioStub();
    const result = await notifyOfferToCarrier(
      {
        db,
        logger: noopLogger,
        twilioClient: twilio,
        contentSidOfferNew: 'HXabc1234567890abcdef1234567890ab',
        webAppUrl: 'https://app.boosterchile.com',
      },
      { offerId: OFFER_ID },
    );
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('already_notified');
    expect(twilio.sendContent).not.toHaveBeenCalled();
    expect(spies.updateFn).not.toHaveBeenCalled();
  });

  it('skipea si no hay owner activo', async () => {
    const { notifyOfferToCarrier } = await import('../../src/services/notify-offer.js');
    const { db } = makeDbStub({ offerJoin: baseOfferJoin(), ownerJoin: null });
    const twilio = makeTwilioStub();
    const result = await notifyOfferToCarrier(
      {
        db,
        logger: noopLogger,
        twilioClient: twilio,
        contentSidOfferNew: 'HXabc1234567890abcdef1234567890ab',
        webAppUrl: 'https://app.boosterchile.com',
      },
      { offerId: OFFER_ID },
    );
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('no_owner');
    expect(twilio.sendContent).not.toHaveBeenCalled();
  });

  it('skipea si owner no tiene whatsapp_e164 (legacy)', async () => {
    const { notifyOfferToCarrier } = await import('../../src/services/notify-offer.js');
    const { db } = makeDbStub({
      offerJoin: baseOfferJoin(),
      ownerJoin: baseOwnerJoin(null),
    });
    const twilio = makeTwilioStub();
    const result = await notifyOfferToCarrier(
      {
        db,
        logger: noopLogger,
        twilioClient: twilio,
        contentSidOfferNew: 'HXabc1234567890abcdef1234567890ab',
        webAppUrl: 'https://app.boosterchile.com',
      },
      { offerId: OFFER_ID },
    );
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('no_whatsapp');
  });

  it('happy path: envía template con variables y marca notified_at', async () => {
    const { notifyOfferToCarrier } = await import('../../src/services/notify-offer.js');
    const { db, spies } = makeDbStub({
      offerJoin: baseOfferJoin(),
      ownerJoin: baseOwnerJoin('+56912345678'),
    });
    const sendContent = vi.fn().mockResolvedValue({
      sid: 'SM_test_notify',
      status: 'queued',
      to: 'whatsapp:+56912345678',
      from: 'whatsapp:+19383365293',
      body: 'Hola...',
      date_created: '2026-05-01T12:00:00Z',
    });
    const twilio = makeTwilioStub({ sendContent });

    const result = await notifyOfferToCarrier(
      {
        db,
        logger: noopLogger,
        twilioClient: twilio,
        contentSidOfferNew: 'HXabc1234567890abcdef1234567890ab',
        webAppUrl: 'https://app.boosterchile.com',
      },
      { offerId: OFFER_ID },
    );

    expect(result.skipped).toBe(false);
    expect(result.twilioMessageSid).toBe('SM_test_notify');

    // Variables del template construidas correctamente.
    expect(sendContent).toHaveBeenCalledOnce();
    const args = sendContent.mock.calls[0]?.[0];
    expect(args.to).toBe('+56912345678');
    expect(args.contentSid).toBe('HXabc1234567890abcdef1234567890ab');
    expect(args.contentVariables).toEqual({
      '1': 'BOO-ABC123',
      '2': 'Metropolitana → Biobío',
      '3': '$ 850.000 CLP',
      '4': 'https://app.boosterchile.com/app/ofertas',
    });

    // notified_at marcado en DB.
    expect(spies.updateFn).toHaveBeenCalledOnce();
    const setArg = spies.updateSetFn.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(setArg.notifiedAt).toBeInstanceOf(Date);
  });

  it('limpia trailing slash de webAppUrl al armar el deep-link', async () => {
    const { notifyOfferToCarrier } = await import('../../src/services/notify-offer.js');
    const { db } = makeDbStub({
      offerJoin: baseOfferJoin(),
      ownerJoin: baseOwnerJoin('+56912345678'),
    });
    const sendContent = vi.fn().mockResolvedValue({
      sid: 'SM_x',
      status: 'queued',
      to: 'whatsapp:+56912345678',
      from: 'whatsapp:+19383365293',
      body: '',
      date_created: '2026-05-01T12:00:00Z',
    });
    const twilio = makeTwilioStub({ sendContent });

    await notifyOfferToCarrier(
      {
        db,
        logger: noopLogger,
        twilioClient: twilio,
        contentSidOfferNew: 'HXabc1234567890abcdef1234567890ab',
        webAppUrl: 'https://app.boosterchile.com/',
      },
      { offerId: OFFER_ID },
    );

    const args = sendContent.mock.calls[0]?.[0];
    expect(args.contentVariables['4']).toBe('https://app.boosterchile.com/app/ofertas');
  });

  it('propaga error de Twilio (caller decide si retry)', async () => {
    const { notifyOfferToCarrier } = await import('../../src/services/notify-offer.js');
    const { db } = makeDbStub({
      offerJoin: baseOfferJoin(),
      ownerJoin: baseOwnerJoin('+56912345678'),
    });
    const sendContent = vi.fn().mockRejectedValue(new Error('Twilio 503'));
    const twilio = makeTwilioStub({ sendContent });

    await expect(
      notifyOfferToCarrier(
        {
          db,
          logger: noopLogger,
          twilioClient: twilio,
          contentSidOfferNew: 'HXabc1234567890abcdef1234567890ab',
          webAppUrl: 'https://app.boosterchile.com',
        },
        { offerId: OFFER_ID },
      ),
    ).rejects.toThrow('Twilio 503');
  });
});
