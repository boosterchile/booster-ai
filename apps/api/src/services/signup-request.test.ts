import type { Auth } from 'firebase-admin/auth';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashOnboardingToken, verifyOnboardingToken } from './onboarding-token.js';
import { approveSignupRequest } from './signup-request.js';

/**
 * T1.3 (onboarding-flow-redesign) — `approveSignupRequest` gateado.
 *   - Sin `adminProvisionedOnboarding` (flag OFF): comportamiento viejo
 *     (precrea `users` + UPDATE), sin token.
 *   - Con `adminProvisionedOnboarding` (flag ON): emite token one-shot, persiste
 *     `token_hash`/`expira_en`/`firebase_uid`, NO precrea `users`, pasa el token
 *     al notify. Conserva `already_processed` (race).
 */

const noop = (): void => undefined;
const noopLogger = {
  trace: noop,
  debug: noop,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: noop,
  child: () => noopLogger,
} as never;

const SECRET = 'a-test-signing-secret-with-enough-bytes-xx'; // >= 32 bytes
const SID = '11111111-1111-4111-8111-111111111111';
const FB_UID = 'fb-new-uid';
const REQUEST = {
  id: SID,
  email: 'nuevo@empresa.cl',
  nombreCompleto: 'Nueva Persona',
  estado: 'pendiente_aprobacion' as const,
};
const ADMIN_PROVISIONED = { signingSecret: SECRET, ttlMs: 72 * 60 * 60 * 1000 };

function makeAuth(uid = FB_UID): Auth {
  return { createUser: vi.fn(async () => ({ uid })) } as unknown as Auth;
}
function makeAuthThrowing(code: string): Auth {
  return {
    createUser: vi.fn(async () => {
      // Firebase Admin lanza Error con `.code` (p.ej. auth/email-already-exists).
      const err = new Error(`firebase: ${code}`) as Error & { code: string };
      err.code = code;
      throw err;
    }),
  } as unknown as Auth;
}

function makeNotifier() {
  return {
    notifyAdminsOfNewRequest: vi.fn(async (_o: unknown) => undefined),
    notifyUserOfApproval: vi.fn(
      async (_o: { onboardingToken?: string; [k: string]: unknown }) => undefined,
    ),
    notifyUserOfRejection: vi.fn(async (_o: unknown) => undefined),
  };
}

interface DbOpts {
  requestRow?: typeof REQUEST | undefined;
  updateRows?: unknown[]; // admin-provisioned UPDATE returning
}

function makeDb(opts: DbOpts = {}) {
  const requestRow = 'requestRow' in opts ? opts.requestRow : REQUEST;
  const capturedSets: Record<string, unknown>[] = [];
  const insertCalls: unknown[] = [];

  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => (requestRow ? [requestRow] : [])),
      })),
    })),
  }));

  // UPDATE top-level (camino admin-provisioned).
  const update = vi.fn(() => ({
    set: vi.fn((vals: Record<string, unknown>) => {
      capturedSets.push(vals);
      return {
        where: vi.fn(() => ({
          returning: vi.fn(async () => opts.updateRows ?? [{ id: SID }]),
        })),
      };
    }),
  }));

  // Transacción (camino viejo flag OFF): INSERT users + UPDATE.
  const tx = {
    insert: vi.fn((table: unknown) => {
      insertCalls.push(table);
      return { values: vi.fn(() => ({ returning: vi.fn(async () => [{ id: 'user-uuid' }]) })) };
    }),
    update: vi.fn(() => ({
      set: vi.fn((vals: Record<string, unknown>) => {
        capturedSets.push(vals);
        return { where: vi.fn(() => ({ returning: vi.fn(async () => [{ id: SID }]) })) };
      }),
    })),
  };
  const transaction = vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx));

  return {
    db: { select, update, transaction } as never,
    capturedSets,
    insertCalls,
    transaction,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('approveSignupRequest — modo viejo (flag OFF)', () => {
  it('precrea users + UPDATE, sin token; userId set, onboardingToken undefined', async () => {
    const { db, insertCalls, transaction } = makeDb();
    const notifier = makeNotifier();
    const result = await approveSignupRequest(db, noopLogger, makeAuth(), notifier, {
      id: SID,
      approverEmail: 'admin@booster.cl',
      loginLinkUrl: 'https://app.boosterchile.com/login',
      correlationId: 'corr-1',
    });
    expect(result).toEqual({ outcome: 'approved', firebaseUid: FB_UID, userId: 'user-uuid' });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(insertCalls.length).toBeGreaterThan(0); // precrea users
    const notifyArg = notifier.notifyUserOfApproval.mock.calls[0]?.[0];
    expect(notifyArg?.onboardingToken).toBeUndefined();
  });
});

describe('approveSignupRequest — modo admin-provisioned (flag ON)', () => {
  it('emite token válido, persiste token_hash/expira_en/firebase_uid, NO precrea users', async () => {
    const { db, capturedSets, insertCalls, transaction } = makeDb();
    const notifier = makeNotifier();
    const result = await approveSignupRequest(db, noopLogger, makeAuth(), notifier, {
      id: SID,
      approverEmail: 'admin@booster.cl',
      loginLinkUrl: 'https://app.boosterchile.com/onboarding',
      correlationId: 'corr-2',
      adminProvisionedOnboarding: ADMIN_PROVISIONED,
    });

    // Resultado: approved, sin userId (no precreate), con token.
    expect(result.outcome).toBe('approved');
    if (result.outcome !== 'approved') {
      return;
    }
    expect(result.userId).toBeNull();
    expect(typeof result.onboardingToken).toBe('string');
    // W1.4 — el approve devuelve la expiración exacta del token emitido,
    // para que la route derive `onboarding_link_expires_at` sin recomputar
    // (coherencia con ONBOARDING_TOKEN_TTL_HOURS garantizada por construcción).
    expect(result.onboardingTokenExpiresAt).toBeInstanceOf(Date);

    // NO precrea users, NO usa transacción.
    expect(insertCalls.length).toBe(0);
    expect(transaction).not.toHaveBeenCalled();

    // El UPDATE persistió los campos del token.
    const set = capturedSets[0] as Record<string, unknown>;
    expect(set.estado).toBe('aprobado');
    expect(set.firebaseUid).toBe(FB_UID);
    expect(set.expiraEn).toBeInstanceOf(Date);
    expect(result.onboardingTokenExpiresAt?.getTime()).toBe((set.expiraEn as Date).getTime());
    expect(typeof set.tokenHash).toBe('string');
    // token_hash persistido == sha256 del token emitido (consistencia).
    expect(set.tokenHash).toBe(hashOnboardingToken(result.onboardingToken as string));

    // El token emitido VERIFICA contra el secreto y trae el sid correcto.
    const v = verifyOnboardingToken({ token: result.onboardingToken as string, secret: SECRET });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.solicitudId).toBe(SID);
    }

    // El token se pasó al notify (para entregar al usuario).
    const notifyArg = notifier.notifyUserOfApproval.mock.calls[0]?.[0];
    expect(notifyArg?.onboardingToken).toBe(result.onboardingToken);
  });

  it('race (UPDATE 0 rows) => already_processed, sin notify ni token', async () => {
    const { db } = makeDb({ updateRows: [] });
    const notifier = makeNotifier();
    const result = await approveSignupRequest(db, noopLogger, makeAuth(), notifier, {
      id: SID,
      approverEmail: 'admin@booster.cl',
      loginLinkUrl: 'https://app.boosterchile.com/onboarding',
      correlationId: 'corr-3',
      adminProvisionedOnboarding: ADMIN_PROVISIONED,
    });
    expect(result).toEqual({ outcome: 'already_processed' });
    expect(notifier.notifyUserOfApproval).not.toHaveBeenCalled();
  });
});

describe('approveSignupRequest — casos previos preservados', () => {
  it('not_found cuando la solicitud no existe', async () => {
    const { db } = makeDb({ requestRow: undefined });
    const result = await approveSignupRequest(db, noopLogger, makeAuth(), makeNotifier(), {
      id: SID,
      approverEmail: 'admin@booster.cl',
      loginLinkUrl: 'x',
      correlationId: 'c',
      adminProvisionedOnboarding: ADMIN_PROVISIONED,
    });
    expect(result).toEqual({ outcome: 'not_found' });
  });

  it('already_processed cuando estado != pendiente_aprobacion', async () => {
    const { db } = makeDb({ requestRow: { ...REQUEST, estado: 'aprobado' as never } });
    const result = await approveSignupRequest(db, noopLogger, makeAuth(), makeNotifier(), {
      id: SID,
      approverEmail: 'admin@booster.cl',
      loginLinkUrl: 'x',
      correlationId: 'c',
      adminProvisionedOnboarding: ADMIN_PROVISIONED,
    });
    expect(result).toEqual({ outcome: 'already_processed' });
  });

  it('firebase_user_already_exists cuando createUser rechaza email-already-exists', async () => {
    const { db, transaction } = makeDb();
    const result = await approveSignupRequest(
      db,
      noopLogger,
      makeAuthThrowing('auth/email-already-exists'),
      makeNotifier(),
      {
        id: SID,
        approverEmail: 'admin@booster.cl',
        loginLinkUrl: 'x',
        correlationId: 'c',
        adminProvisionedOnboarding: ADMIN_PROVISIONED,
      },
    );
    expect(result).toEqual({ outcome: 'firebase_user_already_exists' });
    expect(transaction).not.toHaveBeenCalled();
  });
});
