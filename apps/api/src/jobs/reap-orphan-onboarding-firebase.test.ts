import { describe, expect, it, vi } from 'vitest';
import {
  type OnboardingOrphan,
  listOnboardingOrphans,
  markOnboardingOrphanReaped,
  reapOrphanOnboardingFirebaseUsers,
} from './reap-orphan-onboarding-firebase.js';

const noop = (): void => undefined;
const noopLogger = { info: noop, warn: noop, error: noop } as never;

const ORPHANS: OnboardingOrphan[] = [
  { id: 's1', firebaseUid: 'fb-1' },
  { id: 's2', firebaseUid: 'fb-2' },
];

function makeDeps(orphans: OnboardingOrphan[], deleteImpl?: (uid: string) => Promise<void>) {
  const deleteUser = vi.fn(deleteImpl ?? (async () => undefined));
  const markReaped = vi.fn(async () => undefined);
  const listOrphans = vi.fn(async () => orphans);
  return {
    deps: { auth: { deleteUser }, listOrphans, markReaped, logger: noopLogger },
    deleteUser,
    markReaped,
    listOrphans,
  };
}

describe('reapOrphanOnboardingFirebaseUsers', () => {
  it('dry-run: cuenta lo que borraría, NO borra ni marca', async () => {
    const { deps, deleteUser, markReaped } = makeDeps(ORPHANS);
    const summary = await reapOrphanOnboardingFirebaseUsers(deps, {
      destructive: false,
      maxDeletesPerRun: 50,
    });
    expect(summary).toEqual({ scanned: 2, deleted: 2, alreadyGone: 0, deferred: 0, errors: 0 });
    expect(deleteUser).not.toHaveBeenCalled();
    expect(markReaped).not.toHaveBeenCalled();
  });

  it('destructive: borra el usuario Firebase y marca cada fila', async () => {
    const { deps, deleteUser, markReaped } = makeDeps(ORPHANS);
    const summary = await reapOrphanOnboardingFirebaseUsers(deps, {
      destructive: true,
      maxDeletesPerRun: 50,
    });
    expect(summary.deleted).toBe(2);
    expect(deleteUser).toHaveBeenCalledTimes(2);
    expect(deleteUser).toHaveBeenCalledWith('fb-1');
    expect(deleteUser).toHaveBeenCalledWith('fb-2');
    expect(markReaped).toHaveBeenCalledTimes(2);
    expect(markReaped).toHaveBeenCalledWith('s1');
    expect(markReaped).toHaveBeenCalledWith('s2');
  });

  it('cap: difiere los excedentes al próximo tick', async () => {
    const three = [...ORPHANS, { id: 's3', firebaseUid: 'fb-3' }];
    const { deps, deleteUser, markReaped } = makeDeps(three);
    const summary = await reapOrphanOnboardingFirebaseUsers(deps, {
      destructive: true,
      maxDeletesPerRun: 1,
    });
    expect(summary.deleted).toBe(1);
    expect(summary.deferred).toBe(2);
    expect(deleteUser).toHaveBeenCalledTimes(1);
    expect(markReaped).toHaveBeenCalledTimes(1);
  });

  it('auth/user-not-found: cuenta alreadyGone y marca igual (idempotente)', async () => {
    const notFound = Object.assign(new Error('not found'), { code: 'auth/user-not-found' });
    const { deps, markReaped } = makeDeps([{ id: 's1', firebaseUid: 'fb-1' }], async () => {
      throw notFound;
    });
    const summary = await reapOrphanOnboardingFirebaseUsers(deps, {
      destructive: true,
      maxDeletesPerRun: 50,
    });
    expect(summary).toEqual({ scanned: 1, deleted: 0, alreadyGone: 1, deferred: 0, errors: 0 });
    expect(markReaped).toHaveBeenCalledWith('s1'); // limpia la fila igual
  });

  it('error recuperable: cuenta errors y NO marca (se reintenta)', async () => {
    const boom = new Error('network');
    const { deps, markReaped } = makeDeps([{ id: 's1', firebaseUid: 'fb-1' }], async () => {
      throw boom;
    });
    const summary = await reapOrphanOnboardingFirebaseUsers(deps, {
      destructive: true,
      maxDeletesPerRun: 50,
    });
    expect(summary).toEqual({ scanned: 1, deleted: 0, alreadyGone: 0, deferred: 0, errors: 1 });
    expect(markReaped).not.toHaveBeenCalled(); // no marca → retry next run
  });

  it('sin huérfanos: summary en cero', async () => {
    const { deps } = makeDeps([]);
    const summary = await reapOrphanOnboardingFirebaseUsers(deps, {
      destructive: true,
      maxDeletesPerRun: 50,
    });
    expect(summary).toEqual({ scanned: 0, deleted: 0, alreadyGone: 0, deferred: 0, errors: 0 });
  });
});

describe('listOnboardingOrphans / markOnboardingOrphanReaped (mappers SQL)', () => {
  it('listOnboardingOrphans mapea las filas a {id, firebaseUid}', async () => {
    const pool = {
      query: vi.fn(async (_sql: string, _params?: unknown[]) => ({
        rows: [{ id: 's1', firebase_uid: 'fb-1' }],
        rowCount: 1,
      })),
    };
    const orphans = await listOnboardingOrphans(pool);
    expect(orphans).toEqual([{ id: 's1', firebaseUid: 'fb-1' }]);
    // El predicado del SELECT exige expira_en vencido + sin consumir.
    const sql = pool.query.mock.calls[0]?.[0] ?? '';
    expect(sql).toContain('consumido_en IS NULL');
    expect(sql).toContain('expira_en < now()');
    expect(sql).toContain("estado = 'aprobado'");
  });

  it('markOnboardingOrphanReaped nulea firebase_uid (marcador idempotente)', async () => {
    const pool = {
      query: vi.fn(async (_sql: string, _params?: unknown[]) => ({ rows: [], rowCount: 1 })),
    };
    await markOnboardingOrphanReaped(pool, 's1');
    const call = pool.query.mock.calls[0];
    expect(call?.[0]).toContain('SET firebase_uid = NULL');
    expect(call?.[1]).toEqual(['s1']);
  });
});
