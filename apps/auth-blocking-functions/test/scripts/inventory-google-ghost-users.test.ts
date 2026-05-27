import type { Auth, ListUsersResult, UserRecord } from 'firebase-admin/auth';
import { describe, expect, it, vi } from 'vitest';
import {
  type PoolLike,
  inventoryGoogleGhostUsers,
  toCsv,
} from '../../scripts/inventory-google-ghost-users.js';

/**
 * Sprint 2c-A T8 — ghost user inventory tests (read-only).
 *
 * Tests inject mock `auth` + `pool` to drive the pure inventory logic
 * without firebase-admin / pg connect. No filesystem IO.
 */

function buildUser(props: Partial<UserRecord> & { uid: string }): UserRecord {
  return {
    uid: props.uid,
    email: props.email ?? '',
    emailVerified: props.emailVerified ?? false,
    displayName: props.displayName ?? '',
    phoneNumber: props.phoneNumber ?? '',
    photoURL: props.photoURL ?? '',
    disabled: props.disabled ?? false,
    metadata: props.metadata ?? {
      creationTime: '2026-05-27T00:00:00Z',
      lastSignInTime: '',
      toJSON: () => ({}),
    },
    providerData: props.providerData ?? [],
    toJSON: props.toJSON ?? (() => ({})),
  } as UserRecord;
}

function buildAuthStub(pages: ListUsersResult[]): Pick<Auth, 'listUsers'> {
  const pageIter = pages.values();
  return {
    listUsers: vi.fn(async () => {
      const next = pageIter.next();
      return next.value ?? { users: [], pageToken: undefined };
    }),
  };
}

function buildPoolStub(matches: Record<string, boolean>): PoolLike {
  return {
    query: vi.fn(async (_sql: string, params: unknown[]) => {
      const email = String(params[0] ?? '').toLowerCase();
      return { rowCount: matches[email] ? 1 : 0 };
    }),
  };
}

describe('inventoryGoogleGhostUsers', () => {
  it('filters out users WITHOUT google.com providerData', async () => {
    const auth = buildAuthStub([
      {
        users: [
          buildUser({
            uid: 'u1',
            email: 'pw@example.com',
            providerData: [
              {
                providerId: 'password',
                uid: 'pw-uid',
                displayName: '',
                email: '',
                phoneNumber: '',
                photoURL: '',
                toJSON: () => ({}),
              },
            ],
          }),
          buildUser({
            uid: 'u2',
            email: 'goog@example.com',
            providerData: [
              {
                providerId: 'google.com',
                uid: 'g-uid',
                displayName: '',
                email: '',
                phoneNumber: '',
                photoURL: '',
                toJSON: () => ({}),
              },
            ],
          }),
        ],
        pageToken: undefined,
      },
    ]);
    const pool = buildPoolStub({});
    const result = await inventoryGoogleGhostUsers(auth, pool);
    expect(result).toHaveLength(1);
    expect(result[0]?.firebaseUid).toBe('u2');
  });

  it('paginates over pageToken until exhausted', async () => {
    const auth = buildAuthStub([
      {
        users: [
          buildUser({
            uid: 'g1',
            email: 'a@example.com',
            providerData: [
              {
                providerId: 'google.com',
                uid: 'g1-uid',
                displayName: '',
                email: '',
                phoneNumber: '',
                photoURL: '',
                toJSON: () => ({}),
              },
            ],
          }),
        ],
        pageToken: 'page-2',
      },
      {
        users: [
          buildUser({
            uid: 'g2',
            email: 'b@example.com',
            providerData: [
              {
                providerId: 'google.com',
                uid: 'g2-uid',
                displayName: '',
                email: '',
                phoneNumber: '',
                photoURL: '',
                toJSON: () => ({}),
              },
            ],
          }),
        ],
        pageToken: undefined,
      },
    ]);
    const pool = buildPoolStub({});
    const result = await inventoryGoogleGhostUsers(auth, pool);
    expect(result.map((g) => g.firebaseUid)).toEqual(['g1', 'g2']);
    expect(auth.listUsers).toHaveBeenCalledTimes(2);
  });

  it('marks matchingApprovedRequest=true when DB returns rowCount=1 (case-insensitive)', async () => {
    const auth = buildAuthStub([
      {
        users: [
          buildUser({
            uid: 'g1',
            email: 'CASE@Example.COM',
            providerData: [
              {
                providerId: 'google.com',
                uid: 'g1-uid',
                displayName: '',
                email: '',
                phoneNumber: '',
                photoURL: '',
                toJSON: () => ({}),
              },
            ],
          }),
        ],
        pageToken: undefined,
      },
    ]);
    const pool = buildPoolStub({ 'case@example.com': true });
    const result = await inventoryGoogleGhostUsers(auth, pool);
    expect(result[0]?.matchingApprovedRequest).toBe(true);
  });

  it('marks matchingApprovedRequest=false when DB returns rowCount=0', async () => {
    const auth = buildAuthStub([
      {
        users: [
          buildUser({
            uid: 'g1',
            email: 'unknown@example.com',
            providerData: [
              {
                providerId: 'google.com',
                uid: 'g1-uid',
                displayName: '',
                email: '',
                phoneNumber: '',
                photoURL: '',
                toJSON: () => ({}),
              },
            ],
          }),
        ],
        pageToken: undefined,
      },
    ]);
    const pool = buildPoolStub({});
    const result = await inventoryGoogleGhostUsers(auth, pool);
    expect(result[0]?.matchingApprovedRequest).toBe(false);
  });

  it('skips users with empty email (cannot cross-reference)', async () => {
    const auth = buildAuthStub([
      {
        users: [
          buildUser({
            uid: 'g1',
            email: '',
            providerData: [
              {
                providerId: 'google.com',
                uid: 'g1-uid',
                displayName: '',
                email: '',
                phoneNumber: '',
                photoURL: '',
                toJSON: () => ({}),
              },
            ],
          }),
        ],
        pageToken: undefined,
      },
    ]);
    const pool = buildPoolStub({});
    const result = await inventoryGoogleGhostUsers(auth, pool);
    expect(result).toHaveLength(0);
  });
});

describe('toCsv', () => {
  it('emits header + one row per ghost', () => {
    const csv = toCsv([
      {
        firebaseUid: 'u1',
        email: 'a@example.com',
        displayName: 'Foo',
        createdAt: '2026-05-27T00:00:00Z',
        matchingApprovedRequest: true,
      },
      {
        firebaseUid: 'u2',
        email: 'b@example.com',
        displayName: 'Bar',
        createdAt: '2026-05-27T00:00:01Z',
        matchingApprovedRequest: false,
      },
    ]);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('firebaseUid,email,displayName,createdAt,matchingApprovedRequest');
    expect(lines[1]).toBe('"u1","a@example.com","Foo","2026-05-27T00:00:00Z",true');
    expect(lines[2]).toBe('"u2","b@example.com","Bar","2026-05-27T00:00:01Z",false');
  });

  it('escapes embedded double-quotes in displayName', () => {
    const csv = toCsv([
      {
        firebaseUid: 'u1',
        email: 'a@example.com',
        displayName: 'Foo "the" Bar',
        createdAt: '2026-05-27T00:00:00Z',
        matchingApprovedRequest: false,
      },
    ]);
    expect(csv.split('\n')[1]).toBe(
      '"u1","a@example.com","Foo ""the"" Bar","2026-05-27T00:00:00Z",false',
    );
  });

  it('emits header-only CSV when ghost list is empty', () => {
    const csv = toCsv([]);
    expect(csv).toBe('firebaseUid,email,displayName,createdAt,matchingApprovedRequest');
  });
});
