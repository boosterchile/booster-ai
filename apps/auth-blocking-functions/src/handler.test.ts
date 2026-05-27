import type gcipCloudFunctions from 'gcip-cloud-functions';
import { describe, expect, it } from 'vitest';
import { beforeCreateCallback } from './handler.js';

/**
 * Sprint 2c-A T4 tests — provider passthrough only.
 *
 * Per plan v4 acceptance: "NO T1/T2 yet (per F-02 v1 fix from umbrella)
 * — those require DB code, moved to T7." Tests covering Google provider
 * + approved row / no-row / DB throw land in T7.
 *
 * T4 active branches:
 *   - providerData absent → return {} (passthrough)
 *   - providerData empty → return {} (passthrough)
 *   - providerData non-Google → return {} (passthrough)
 *
 * T5-T7 placeholder branch is istanbul-ignored; not tested here.
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

  it('T5+T6: Google + valid email reaches normalize + getDbPool (placeholder throws pending T7)', async () => {
    const user = buildUser([{ providerId: 'google.com', uid: 'g-uid' }]);
    user.email = 'foo@example.com';
    // Placeholder throw (c8-ignored) is the sentinel for un-shipped T7
    // chain. Test verifies the normalize + getDbPool call lines are
    // reached (and getDbPool returns a pg.Pool without trying to
    // connect — lazy until .query()).
    await expect(beforeCreateCallback(user, STUB_CONTEXT)).rejects.toThrow(
      /handler T7 logic not yet implemented/,
    );
  });
});

describe('beforeCreateCallback (structure smoke)', () => {
  it('is an async function', () => {
    expect(typeof beforeCreateCallback).toBe('function');
    expect(beforeCreateCallback.constructor.name).toBe('AsyncFunction');
  });
});
