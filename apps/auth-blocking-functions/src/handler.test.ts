import type gcipCloudFunctions from 'gcip-cloud-functions';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the DB pool module BEFORE the handler imports it. vitest hoists
// `vi.mock` to the top of the file, so the handler sees the mocked
// `getDbPool` at import time.
const mockQuery = vi.fn();
vi.mock('./db.js', () => ({
  getDbPool: vi.fn(() => ({ query: mockQuery })),
  __resetDbPoolForTests: vi.fn(),
}));

// Mock the logger so we can both keep tests silent and assert log
// payloads do not contain plaintext email.
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};
vi.mock('./logger.js', () => ({
  logger: mockLogger,
}));

const { beforeCreateCallback } = await import('./handler.js');

/**
 * Sprint 2c-A T7 — handler full-flow tests (T1+T2+T3+T7 per spec §10).
 *
 * T4 active branches (providers passthrough) and T5/T6 (email check +
 * normalize + getDbPool reach) covered in earlier describe blocks.
 *
 * New tests in this PR:
 *   - T1: DB rowCount=0 (no approval row) → permission-denied.
 *   - T2: DB rowCount=1 (approved row) → returns {} (allow signup).
 *   - T3: DB throws → internal HttpsError (fail-closed via internal status).
 *   - T7: DB rowCount=0 because estado != aprobado (query WHERE filter)
 *     → permission-denied. Documents the invariant that non-approved
 *     estado cannot reach rowCount >= 1.
 *
 * PII assertions: log payloads never contain `email` plaintext (only
 * `emailHashed` SHA-256 truncated).
 */

function buildUser(
  providerData: Array<Partial<gcipCloudFunctions.UserInfo>> | undefined,
): gcipCloudFunctions.UserRecord {
  return {
    uid: 'test-uid',
    email: 'test@example.com',
    emailVerified: false,
    displayName: 'Test',
    phoneNumber: '',
    photoURL: '',
    disabled: false,
    metadata: {
      lastSignInTime: '',
      creationTime: '',
      toJSON: () => ({}),
    },
    providerData: providerData as gcipCloudFunctions.UserInfo[],
    toJSON: () => ({}),
  };
}

const STUB_CONTEXT = {
  eventId: 'test-event',
  timestamp: new Date().toISOString(),
  eventType: 'providers/cloud.auth/eventTypes/user.beforeCreate',
  resource: 'projects/test-project',
  params: {},
  ipAddress: '127.0.0.1',
  userAgent: 'test-ua',
} as unknown as gcipCloudFunctions.AuthEventContext;

beforeEach(() => {
  mockQuery.mockReset();
  mockLogger.info.mockReset();
  mockLogger.warn.mockReset();
  mockLogger.error.mockReset();
});

describe('beforeCreateCallback (T4 active branches)', () => {
  it('returns {} when providerData is undefined (passthrough)', async () => {
    const user = buildUser(undefined);
    const result = await beforeCreateCallback(user, STUB_CONTEXT);
    expect(result).toEqual({});
  });

  it('returns {} when providerData is empty array (passthrough)', async () => {
    const user = buildUser([]);
    const result = await beforeCreateCallback(user, STUB_CONTEXT);
    expect(result).toEqual({});
  });

  it('returns {} for password provider (non-Google passthrough)', async () => {
    const user = buildUser([{ providerId: 'password', uid: 'pw-uid', email: 'test@example.com' }]);
    const result = await beforeCreateCallback(user, STUB_CONTEXT);
    expect(result).toEqual({});
  });

  it('returns {} for SAML provider (non-Google passthrough)', async () => {
    const user = buildUser([{ providerId: 'saml.example', uid: 'saml-uid' }]);
    const result = await beforeCreateCallback(user, STUB_CONTEXT);
    expect(result).toEqual({});
  });

  it('returns {} when no provider matches google.com (multiple non-Google providers)', async () => {
    const user = buildUser([
      { providerId: 'password', uid: 'pw-uid' },
      { providerId: 'phone', uid: 'phone-uid' },
    ]);
    const result = await beforeCreateCallback(user, STUB_CONTEXT);
    expect(result).toEqual({});
  });
});

describe('beforeCreateCallback (T5 — email validation in Google branch)', () => {
  it('T6: throws HttpsError invalid-argument when Google user has no email', async () => {
    const user = buildUser([{ providerId: 'google.com', uid: 'g-uid' }]);
    user.email = '' as unknown as string;
    await expect(beforeCreateCallback(user, STUB_CONTEXT)).rejects.toMatchObject({
      status: 'INVALID_ARGUMENT',
    });
  });

  it('T6: throws HttpsError invalid-argument when email is undefined-coerced', async () => {
    const user = buildUser([{ providerId: 'google.com', uid: 'g-uid' }]);
    Reflect.deleteProperty(user, 'email');
    await expect(beforeCreateCallback(user, STUB_CONTEXT)).rejects.toMatchObject({
      status: 'INVALID_ARGUMENT',
    });
  });
});

describe('beforeCreateCallback (T7 — DB lookup full flow)', () => {
  it('T1: rowCount=0 (no approval row) → throws permission-denied with BLOCKED_CODE', async () => {
    mockQuery.mockResolvedValue({ rowCount: 0, rows: [] });
    const user = buildUser([{ providerId: 'google.com', uid: 'g-uid' }]);
    user.email = 'unknown@example.com';
    await expect(beforeCreateCallback(user, STUB_CONTEXT)).rejects.toMatchObject({
      status: 'PERMISSION_DENIED',
      message: 'BLOCKED_SIGNUP_PENDING_APPROVAL',
    });
    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    const warnCall = mockLogger.warn.mock.calls[0]?.[0] ?? {};
    expect(warnCall.event).toBe('signup.blocked.google');
    expect(JSON.stringify(warnCall)).not.toContain('unknown@example.com');
  });

  it('T2: rowCount=1 (approved row) → returns {} (allow signup)', async () => {
    mockQuery.mockResolvedValue({ rowCount: 1, rows: [{ '?column?': 1 }] });
    const user = buildUser([{ providerId: 'google.com', uid: 'g-uid' }]);
    user.email = 'approved@example.com';
    const result = await beforeCreateCallback(user, STUB_CONTEXT);
    expect(result).toEqual({});
    expect(mockLogger.info).toHaveBeenCalledTimes(1);
    const infoCall = mockLogger.info.mock.calls[0]?.[0] ?? {};
    expect(infoCall.event).toBe('signup.allowed.google');
    expect(JSON.stringify(infoCall)).not.toContain('approved@example.com');
  });

  it('T3: DB pool.query rejects → throws HttpsError internal with BLOCKED_CODE', async () => {
    mockQuery.mockRejectedValue(new Error('connection refused'));
    const user = buildUser([{ providerId: 'google.com', uid: 'g-uid' }]);
    user.email = 'transient@example.com';
    await expect(beforeCreateCallback(user, STUB_CONTEXT)).rejects.toMatchObject({
      status: 'INTERNAL',
      message: 'BLOCKED_SIGNUP_PENDING_APPROVAL',
    });
    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    const errCall = mockLogger.error.mock.calls[0]?.[0] ?? {};
    expect(errCall.event).toBe('signup.gate.db_error');
    expect(errCall.err).toBe('connection refused');
    expect(JSON.stringify(errCall)).not.toContain('transient@example.com');
  });

  it('T7: non-aprobado estado → rowCount=0 → permission-denied (query filters estado=aprobado)', async () => {
    // DB has the row but estado='pendiente'; the query `WHERE estado='aprobado'`
    // filter means rowCount=0, indistinguishable at handler level from T1.
    // Test documents the invariant: gate cannot allow non-approved estado.
    mockQuery.mockResolvedValue({ rowCount: 0, rows: [] });
    const user = buildUser([{ providerId: 'google.com', uid: 'g-uid' }]);
    user.email = 'pending@example.com';
    await expect(beforeCreateCallback(user, STUB_CONTEXT)).rejects.toMatchObject({
      status: 'PERMISSION_DENIED',
      message: 'BLOCKED_SIGNUP_PENDING_APPROVAL',
    });
  });

  it('T7: query receives normalized lowercase email (not original casing)', async () => {
    mockQuery.mockResolvedValue({ rowCount: 1, rows: [{ '?column?': 1 }] });
    const user = buildUser([{ providerId: 'google.com', uid: 'g-uid' }]);
    user.email = 'MixedCase@Example.COM';
    await beforeCreateCallback(user, STUB_CONTEXT);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const queryCall = mockQuery.mock.calls[0];
    expect(queryCall?.[1]).toEqual(['mixedcase@example.com']);
  });

  it('T7: query receives IDN-decoded punycode domain in normalized email', async () => {
    mockQuery.mockResolvedValue({ rowCount: 1, rows: [{ '?column?': 1 }] });
    const user = buildUser([{ providerId: 'google.com', uid: 'g-uid' }]);
    user.email = 'foo@xn--mller-kva.de';
    await beforeCreateCallback(user, STUB_CONTEXT);
    const queryCall = mockQuery.mock.calls[0];
    expect(queryCall?.[1]).toEqual(['foo@müller.de']);
  });

  it('T3 variant: non-Error rejection (e.g., string) logs `unknown` err message', async () => {
    mockQuery.mockRejectedValue('connection refused');
    const user = buildUser([{ providerId: 'google.com', uid: 'g-uid' }]);
    user.email = 'foo@example.com';
    await expect(beforeCreateCallback(user, STUB_CONTEXT)).rejects.toMatchObject({
      status: 'INTERNAL',
    });
    const errCall = mockLogger.error.mock.calls[0]?.[0] ?? {};
    expect(errCall.err).toBe('unknown');
  });

  it('T7 variant: pg returns null rowCount → coalesces to 0 → permission-denied', async () => {
    mockQuery.mockResolvedValue({ rowCount: null, rows: [] });
    const user = buildUser([{ providerId: 'google.com', uid: 'g-uid' }]);
    user.email = 'foo@example.com';
    await expect(beforeCreateCallback(user, STUB_CONTEXT)).rejects.toMatchObject({
      status: 'PERMISSION_DENIED',
      message: 'BLOCKED_SIGNUP_PENDING_APPROVAL',
    });
  });
});

describe('beforeCreateCallback (structure smoke)', () => {
  it('is an async function', () => {
    expect(typeof beforeCreateCallback).toBe('function');
    expect(beforeCreateCallback.constructor.name).toBe('AsyncFunction');
  });
});
