/**
 * Tests del endpoint POST /internal/safety-events (Task 10).
 *
 * Cubre:
 *   - Auth: token ausente → 401.
 *   - Auth: JWT inválido/expirado → 401.
 *   - Auth: email mismatch → 403.
 *   - Auth: SAFETY_PUSH_CALLER_SA no configurado → 403 (fail-closed).
 *   - Envelope inválido → 400.
 *   - SafetyEvent inválido → 400.
 *   - Vehículo desconocido (routing null) → 200 outcome:unknown_vehicle.
 *   - Dispatch exitoso → 200 outcome.
 *   - Dispatch throws → 500.
 */

import type { Logger } from '@booster-ai/logger';
import type { SafetyEvent } from '@booster-ai/shared-schemas';
import type { LoginTicket, OAuth2Client, TokenPayload } from 'google-auth-library';
import type { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../db/client.js';
import type { DispatchOutcome } from '../services/dispatch-safety-notification.js';
import type { SafetyRouting } from '../services/route-safety-recipients.js';
import {
  type InternalSafetyEventsConfig,
  createInternalSafetyEventsRoutes,
} from './internal-safety-events.js';

// ── Logger stub ──────────────────────────────────────────────────────────────

const noop = (): void => undefined;
const noopLogger = {
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  fatal: noop,
  child: () => noopLogger,
} as unknown as Logger;

// ── Fixtures ─────────────────────────────────────────────────────────────────

const CALLER_SA = 'safety-pubsub@booster-ai.iam.gserviceaccount.com';
const API_AUDIENCE = ['https://api.boosterchile.com'];

const VALID_EVENT = {
  eventType: 'crash' as const,
  imei: '123456789012345',
  vehicleId: '00000000-0000-0000-0000-000000000001',
  occurredAt: '2026-06-15T10:00:00Z',
};

const VALID_ROUTING: SafetyRouting = {
  empresaId: 'empresa-1',
  vehicleLabel: 'ABC-123',
  trackingCode: 'TRK-001',
  recipients: [{ userId: 'user-1', phoneE164: '+56912345678' }],
};

function makeEnvelopeBody(event: unknown): Record<string, unknown> {
  return {
    message: {
      data: Buffer.from(JSON.stringify(event)).toString('base64'),
      messageId: 'msg-001',
    },
    subscription: 'projects/booster-ai/subscriptions/safety-events-sub',
  };
}

// ── OAuth2Client stub factory ─────────────────────────────────────────────────

function makeOAuthClient(opts: {
  shouldThrow?: boolean;
  email?: string;
}): OAuth2Client {
  const verifyIdToken = vi.fn(async () => {
    if (opts.shouldThrow) {
      throw new Error('Token verification failed');
    }
    const payload: Partial<TokenPayload> = {
      ...(opts.email !== undefined ? { email: opts.email } : {}),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    const ticket = {
      getPayload: () => payload as TokenPayload,
    } as LoginTicket;
    return ticket;
  });
  return { verifyIdToken } as unknown as OAuth2Client;
}

// ── App factory ───────────────────────────────────────────────────────────────

/**
 * `callerSa` uses a sentinel to distinguish "not provided" (default to CALLER_SA)
 * from "explicitly undefined" (SAFETY_PUSH_CALLER_SA not configured).
 */
const UNSET = Symbol('UNSET');

type DispatchFn = (o: {
  redis: Redis;
  db: Db;
  logger: Logger;
  event: SafetyEvent;
  routing: SafetyRouting;
  contentSidSafety?: string;
  sendPush: (a: {
    db: Db;
    logger: Logger;
    userId: string;
    payload: {
      title: string;
      body: string;
      tag: string;
      data: { assignment_id: string; message_id: string; url: string };
    };
  }) => Promise<unknown>;
  sendWhatsapp: (a: {
    to: string;
    contentSid: string;
    contentVariables: Record<string, string>;
  }) => Promise<unknown>;
}) => Promise<DispatchOutcome>;

function makeApp(opts: {
  callerSa?: string | typeof UNSET;
  oauthClient: OAuth2Client;
  routeRecipients?: (o: {
    db: Db;
    imei: string;
    vehicleId?: string;
  }) => Promise<SafetyRouting | null>;
  dispatch?: DispatchFn;
  sendWhatsapp?: () => Promise<unknown>;
}) {
  const config: InternalSafetyEventsConfig = {
    safetyPushCallerSa: opts.callerSa === UNSET ? undefined : (opts.callerSa ?? CALLER_SA),
    apiAudience: API_AUDIENCE,
    contentSidSafetyAlert: undefined,
  };

  const db = {} as unknown as Db;
  const redis = {} as unknown as Redis;

  return createInternalSafetyEventsRoutes({
    db,
    redis,
    logger: noopLogger,
    config,
    sendWhatsapp: opts.sendWhatsapp ?? vi.fn().mockResolvedValue(undefined),
    oauthClient: opts.oauthClient,
    ...(opts.routeRecipients !== undefined ? { routeRecipients: opts.routeRecipients } : {}),
    ...(opts.dispatch !== undefined ? { dispatch: opts.dispatch } : {}),
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function makeRequest(opts: {
  app: ReturnType<typeof makeApp>;
  authorization?: string;
  body?: unknown;
}): Promise<Response> {
  const body = opts.body !== undefined ? opts.body : makeEnvelopeBody(VALID_EVENT);
  return await opts.app.request('/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(opts.authorization !== undefined ? { Authorization: opts.authorization } : {}),
    },
    body: JSON.stringify(body),
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /internal/safety-events', () => {
  describe('Auth', () => {
    it('returns 401 when Authorization header is missing', async () => {
      const oauthClient = makeOAuthClient({ email: CALLER_SA });
      const dispatch = vi.fn();
      const app = makeApp({ oauthClient, dispatch: dispatch as unknown as DispatchFn });

      const res = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(makeEnvelopeBody(VALID_EVENT)),
      });

      expect(res.status).toBe(401);
      expect(dispatch).not.toHaveBeenCalled();
    });

    it('returns 401 when JWT verification throws', async () => {
      const oauthClient = makeOAuthClient({ shouldThrow: true });
      const dispatch = vi.fn();
      const app = makeApp({ oauthClient, dispatch: dispatch as unknown as DispatchFn });

      const res = await makeRequest({ app, authorization: 'Bearer invalid-token' });

      expect(res.status).toBe(401);
      expect(dispatch).not.toHaveBeenCalled();
    });

    it('returns 403 when JWT email does not match SAFETY_PUSH_CALLER_SA', async () => {
      const oauthClient = makeOAuthClient({ email: 'other-sa@booster-ai.iam.gserviceaccount.com' });
      const dispatch = vi.fn();
      const app = makeApp({ oauthClient, dispatch: dispatch as unknown as DispatchFn });

      const res = await makeRequest({ app, authorization: 'Bearer valid-token' });

      expect(res.status).toBe(403);
      expect(dispatch).not.toHaveBeenCalled();
    });

    it('returns 403 when SAFETY_PUSH_CALLER_SA is not configured (fail-closed)', async () => {
      const oauthClient = makeOAuthClient({ email: CALLER_SA });
      const dispatch = vi.fn();
      const app = makeApp({
        callerSa: UNSET,
        oauthClient,
        dispatch: dispatch as unknown as DispatchFn,
      });

      const res = await makeRequest({ app, authorization: 'Bearer valid-token' });

      expect(res.status).toBe(403);
      expect(dispatch).not.toHaveBeenCalled();
    });
  });

  describe('Envelope and event validation', () => {
    it('returns 400 when Pub/Sub envelope is malformed (missing message field)', async () => {
      const oauthClient = makeOAuthClient({ email: CALLER_SA });
      const app = makeApp({ oauthClient });

      const res = await makeRequest({
        app,
        authorization: 'Bearer valid-token',
        body: { subscription: 'some-sub' }, // missing message
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 when message.data is not a valid SafetyEvent', async () => {
      const oauthClient = makeOAuthClient({ email: CALLER_SA });
      const dispatch = vi.fn();
      const app = makeApp({ oauthClient, dispatch: dispatch as unknown as DispatchFn });

      const invalidEvent = { eventType: 'crash', imei: 'NOT-A-VALID-IMEI' }; // missing occurredAt, bad imei
      const res = await makeRequest({
        app,
        authorization: 'Bearer valid-token',
        body: makeEnvelopeBody(invalidEvent),
      });

      expect(res.status).toBe(400);
      expect(dispatch).not.toHaveBeenCalled();
    });

    it('returns 400 when message.data is not valid JSON after base64 decode', async () => {
      const oauthClient = makeOAuthClient({ email: CALLER_SA });
      const app = makeApp({ oauthClient });

      const res = await makeRequest({
        app,
        authorization: 'Bearer valid-token',
        body: {
          message: {
            data: Buffer.from('not-json-at-all').toString('base64'),
            messageId: 'msg-001',
          },
          subscription: 'projects/booster-ai/subscriptions/safety-events-sub',
        },
      });

      expect(res.status).toBe(400);
    });
  });

  describe('Routing', () => {
    it('returns 200 with outcome:unknown_vehicle when vehicle is not found, without dispatching', async () => {
      const oauthClient = makeOAuthClient({ email: CALLER_SA });
      const dispatch = vi.fn();
      const routeRecipients = vi.fn().mockResolvedValue(null);

      const app = makeApp({
        oauthClient,
        routeRecipients,
        dispatch: dispatch as unknown as DispatchFn,
      });

      const res = await makeRequest({ app, authorization: 'Bearer valid-token' });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json).toEqual({ outcome: 'unknown_vehicle' });
      expect(dispatch).not.toHaveBeenCalled();
    });
  });

  describe('Dispatch', () => {
    it('returns 200 with dispatch outcome when valid event is received for a known vehicle', async () => {
      const oauthClient = makeOAuthClient({ email: CALLER_SA });
      const routeRecipients = vi.fn().mockResolvedValue(VALID_ROUTING);
      const dispatch = vi.fn().mockResolvedValue('notified' as DispatchOutcome);

      const app = makeApp({
        oauthClient,
        routeRecipients,
        dispatch: dispatch as unknown as DispatchFn,
      });

      const res = await makeRequest({ app, authorization: 'Bearer valid-token' });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json).toEqual({ outcome: 'notified' });
      expect(dispatch).toHaveBeenCalledOnce();
    });

    it('returns 200 with outcome:deduped when dispatch returns deduped', async () => {
      const oauthClient = makeOAuthClient({ email: CALLER_SA });
      const routeRecipients = vi.fn().mockResolvedValue(VALID_ROUTING);
      const dispatch = vi.fn().mockResolvedValue('deduped' as DispatchOutcome);

      const app = makeApp({
        oauthClient,
        routeRecipients,
        dispatch: dispatch as unknown as DispatchFn,
      });

      const res = await makeRequest({ app, authorization: 'Bearer valid-token' });
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json).toEqual({ outcome: 'deduped' });
    });

    it('returns 500 when dispatch throws unexpectedly (so Pub/Sub retries)', async () => {
      const oauthClient = makeOAuthClient({ email: CALLER_SA });
      const routeRecipients = vi.fn().mockResolvedValue(VALID_ROUTING);
      const dispatch = vi.fn().mockRejectedValue(new Error('Redis connection lost'));

      const app = makeApp({
        oauthClient,
        routeRecipients,
        dispatch: dispatch as unknown as DispatchFn,
      });

      const res = await makeRequest({ app, authorization: 'Bearer valid-token' });

      expect(res.status).toBe(500);
    });
  });
});
