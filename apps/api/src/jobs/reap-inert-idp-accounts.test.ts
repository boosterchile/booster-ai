import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_REAPER_GRACE_DAYS,
  type ReaperFacts,
  isReapable,
} from '../services/reaper-predicate.js';
import {
  type ReaperRunConfig,
  type ReaperRunDeps,
  decideAction,
  fetchReaperFacts,
  hashEmailForLog,
  reapInertIdpAccounts,
} from './reap-inert-idp-accounts.js';

/**
 * Tests para T8 / SC-G4 — runner del reaper.
 *
 * Cubre los tests del spec §10: T6 (dry-run default no escribe; flag
 * destructivo requerido), T7 (logs con email hasheado), T12 (tenant >1000
 * → listado paginado completo sin orphans) + disable-before-delete + 2º grace.
 */

const NOW = new Date('2026-06-04T00:00:00Z');
const daysAgo = (n: number): string => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const cfg = (overrides: Partial<ReaperRunConfig> = {}): ReaperRunConfig => ({
  destructive: false,
  graceDays: DEFAULT_REAPER_GRACE_DAYS,
  secondGraceDays: 30,
  neverReapable: new Set(['dev@boosterchile.com']),
  now: NOW,
  maxDeletesPerRun: 50,
  ...overrides,
});

interface FakeUser {
  uid: string;
  email?: string | null;
  disabled?: boolean;
  displayName?: string;
  customClaims?: Record<string, unknown>;
  providerData?: { providerId: string }[];
  metadata?: { creationTime: string; lastSignInTime?: string };
}

const inertUser = (overrides: Partial<FakeUser> = {}): FakeUser => ({
  uid: 'uid-inert',
  email: 'inert@x.cl',
  disabled: false,
  displayName: '',
  customClaims: {},
  providerData: [{ providerId: 'google.com' }],
  metadata: { creationTime: daysAgo(90), lastSignInTime: daysAgo(90) },
  ...overrides,
});

/** Mock Auth con listUsers paginado por chunks de 1000. */
function fakeAuth(users: FakeUser[]) {
  const updateUser = vi.fn(async () => ({}));
  const deleteUser = vi.fn(async () => undefined);
  const setCustomUserClaims = vi.fn(async () => undefined);
  const listUsers = vi.fn(async (_max: number, pageToken?: string) => {
    const start = pageToken ? Number(pageToken) : 0;
    const slice = users.slice(start, start + 1000);
    const next = start + 1000 < users.length ? String(start + 1000) : undefined;
    return { users: slice, pageToken: next };
  });
  return { listUsers, updateUser, deleteUser, setCustomUserClaims };
}

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

// fetchFacts stub: por defecto sin match (INERT).
const noFacts = async (): Promise<ReaperFacts> => ({ usersRows: [], solicitudActive: false });

const deps = (auth: ReturnType<typeof fakeAuth>, log = logger(), fetchFacts = noFacts) =>
  ({ auth, logger: log, fetchFacts }) as unknown as ReaperRunDeps;

describe('reap-inert-idp-accounts — hashEmailForLog (PII, T7)', () => {
  it('hashea (no revela el email) y es determinístico', () => {
    const h = hashEmailForLog('inert@x.cl');
    expect(h).not.toContain('inert');
    expect(h).toMatch(/^[a-f0-9]{16}$/);
    expect(hashEmailForLog('inert@x.cl')).toBe(h);
  });
});

describe('reap-inert-idp-accounts — decideAction (puro)', () => {
  const base = { disabled: false, reaperDisabledAt: undefined as string | undefined };

  it('reapable + enabled → disable', () => {
    expect(decideAction(true, base, NOW, 30)).toBe('disable');
  });
  it('reapable + disabled-by-reaper + 2º grace pasado → delete', () => {
    expect(decideAction(true, { disabled: true, reaperDisabledAt: daysAgo(31) }, NOW, 30)).toBe(
      'delete',
    );
  });
  it('reapable + disabled-by-reaper dentro de 2º grace → wait', () => {
    expect(decideAction(true, { disabled: true, reaperDisabledAt: daysAgo(5) }, NOW, 30)).toBe(
      'wait',
    );
  });
  it('límite EXACTO del 2º grace (30d) → delete (>=, P1-1)', () => {
    expect(decideAction(true, { disabled: true, reaperDisabledAt: daysAgo(30) }, NOW, 30)).toBe(
      'delete',
    );
  });
  it('reaperDisabledAt con fecha inválida → wait (no borra, fail-safe)', () => {
    expect(decideAction(true, { disabled: true, reaperDisabledAt: 'not-a-date' }, NOW, 30)).toBe(
      'wait',
    );
  });
  it('reapable + disabled sin marker (lo deshabilitó otro) → wait (no borrar)', () => {
    expect(decideAction(true, { disabled: true, reaperDisabledAt: undefined }, NOW, 30)).toBe(
      'wait',
    );
  });
  it('no reapable → skip', () => {
    expect(decideAction(false, base, NOW, 30)).toBe('skip');
  });
});

describe('reap-inert-idp-accounts — reapInertIdpAccounts', () => {
  it('T6: dry-run default NO escribe (sin updateUser/deleteUser/setCustomUserClaims)', async () => {
    const auth = fakeAuth([inertUser()]);
    const summary = await reapInertIdpAccounts(deps(auth), cfg());
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(auth.deleteUser).not.toHaveBeenCalled();
    expect(auth.setCustomUserClaims).not.toHaveBeenCalled();
    expect(summary.actions.disable).toBe(1); // lo que HARÍA
  });

  it('destructive: reapable enabled → disable + marca reaperDisabledAt (reversible)', async () => {
    const auth = fakeAuth([inertUser()]);
    await reapInertIdpAccounts(deps(auth), cfg({ destructive: true }));
    expect(auth.updateUser).toHaveBeenCalledWith('uid-inert', { disabled: true });
    expect(auth.setCustomUserClaims).toHaveBeenCalledWith(
      'uid-inert',
      expect.objectContaining({ reaperDisabledAt: expect.any(String) }),
    );
    expect(auth.deleteUser).not.toHaveBeenCalled();
  });

  it('B-limbo (REVIEW): setCustomUserClaims se llama ANTES de updateUser(disabled)', async () => {
    const auth = fakeAuth([inertUser()]);
    await reapInertIdpAccounts(deps(auth), cfg({ destructive: true }));
    const claimsOrder = auth.setCustomUserClaims.mock.invocationCallOrder[0];
    const updateOrder = auth.updateUser.mock.invocationCallOrder[0];
    expect(claimsOrder).toBeDefined();
    expect(updateOrder).toBeDefined();
    expect(claimsOrder as number).toBeLessThan(updateOrder as number);
  });

  it('J-cap (REVIEW): borrados que exceden maxDeletesPerRun se difieren a wait', async () => {
    const dels = [40, 41, 42].map((i) =>
      inertUser({
        uid: `u-${i}`,
        email: `${i}@x.cl`,
        disabled: true,
        customClaims: { reaperDisabledAt: daysAgo(40) },
      }),
    );
    const auth = fakeAuth(dels);
    const summary = await reapInertIdpAccounts(
      deps(auth),
      cfg({ destructive: true, maxDeletesPerRun: 2 }),
    );
    expect(summary.actions.delete).toBe(2);
    expect(summary.actions.wait).toBe(1); // el 3º diferido
    expect(auth.deleteUser).toHaveBeenCalledTimes(2);
  });

  it('C (REVIEW): en dry-run una cuenta delete-elegible logea event=delete con destructive:false', async () => {
    const log = logger();
    const u = inertUser({ disabled: true, customClaims: { reaperDisabledAt: daysAgo(40) } });
    await reapInertIdpAccounts(deps(fakeAuth([u]), log), cfg({ destructive: false }));
    const deleteLog = log.info.mock.calls.find(
      (c) => (c[0] as { event?: string })?.event === 'reaper.account.delete',
    );
    expect(deleteLog).toBeDefined();
    expect((deleteLog?.[0] as { destructive?: boolean }).destructive).toBe(false);
  });

  it('destructive: disabled-by-reaper + 2º grace pasado → delete', async () => {
    const u = inertUser({ disabled: true, customClaims: { reaperDisabledAt: daysAgo(40) } });
    const auth = fakeAuth([u]);
    await reapInertIdpAccounts(deps(auth), cfg({ destructive: true }));
    expect(auth.deleteUser).toHaveBeenCalledWith('uid-inert');
  });

  it('destructive: disabled-by-reaper dentro de 2º grace → wait (no delete)', async () => {
    const u = inertUser({ disabled: true, customClaims: { reaperDisabledAt: daysAgo(5) } });
    const auth = fakeAuth([u]);
    await reapInertIdpAccounts(deps(auth), cfg({ destructive: true }));
    expect(auth.deleteUser).not.toHaveBeenCalled();
  });

  it('hard-guard: cuenta con fila users → skip (ni disable ni delete) aun destructive', async () => {
    const auth = fakeAuth([inertUser()]);
    const fetchFacts = async () => ({
      usersRows: [{ firebaseUid: 'uid-inert', email: 'inert@x.cl' }],
      solicitudActive: false,
    });
    const summary = await reapInertIdpAccounts(
      deps(auth, logger(), fetchFacts),
      cfg({ destructive: true }),
    );
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(auth.deleteUser).not.toHaveBeenCalled();
    expect(summary.actions.skip).toBe(1);
  });

  it('T7: el log de acción usa emailHashed, nunca el email crudo', async () => {
    const log = logger();
    const auth = fakeAuth([inertUser()]);
    await reapInertIdpAccounts(deps(auth, log), cfg());
    const allCalls = [...log.info.mock.calls, ...log.warn.mock.calls];
    const serialized = JSON.stringify(allCalls);
    expect(serialized).not.toContain('inert@x.cl');
    expect(serialized).toContain(hashEmailForLog('inert@x.cl'));
  });

  it('T7 (P0-1): los paths delete y wait también logean email hasheado, nunca crudo', async () => {
    const log = logger();
    const del = inertUser({
      uid: 'u-del',
      email: 'del@x.cl',
      disabled: true,
      customClaims: { reaperDisabledAt: daysAgo(40) },
    });
    const wait = inertUser({
      uid: 'u-wait',
      email: 'wait@x.cl',
      disabled: true,
      customClaims: { reaperDisabledAt: daysAgo(5) },
    });
    const auth = fakeAuth([del, wait]);
    const summary = await reapInertIdpAccounts(deps(auth, log), cfg({ destructive: true }));
    expect(summary.actions.delete).toBe(1);
    expect(summary.actions.wait).toBe(1);
    const serialized = JSON.stringify(log.info.mock.calls);
    expect(serialized).not.toContain('del@x.cl');
    expect(serialized).not.toContain('wait@x.cl');
    expect(serialized).toContain(hashEmailForLog('del@x.cl'));
    expect(serialized).toContain(hashEmailForLog('wait@x.cl'));
  });

  it('T12: >1000 cuentas → listado paginado completo (sin orphans)', async () => {
    const users = Array.from({ length: 2500 }, (_, i) =>
      inertUser({ uid: `uid-${i}`, email: `u${i}@x.cl` }),
    );
    const auth = fakeAuth(users);
    const summary = await reapInertIdpAccounts(deps(auth), cfg());
    expect(summary.scanned).toBe(2500);
    expect(auth.listUsers).toHaveBeenCalledTimes(3); // 1000 + 1000 + 500
  });

  it('emite un summary event con conteos correctos (para el log-based metric / counter)', async () => {
    const log = logger();
    const auth = fakeAuth([inertUser(), inertUser({ uid: 'u2', email: 'dev@boosterchile.com' })]);
    await reapInertIdpAccounts(deps(auth, log), cfg());
    const summaryCall = log.info.mock.calls.find(
      (c) => (c[0] as { event?: string })?.event === 'reaper.run.summary',
    );
    expect(summaryCall).toBeDefined();
    const fields = summaryCall?.[0] as Record<string, unknown>;
    // inert@x.cl → disable; dev@boosterchile.com (never-reapable) → skip
    expect(fields).toMatchObject({
      event: 'reaper.run.summary',
      destructive: false,
      scanned: 2,
      disable: 1,
      delete: 0,
      wait: 0,
      skip: 1,
    });
  });

  it('cuenta fuera de scope (no Google) → skip', async () => {
    const auth = fakeAuth([inertUser({ providerData: [{ providerId: 'phone' }] })]);
    const summary = await reapInertIdpAccounts(deps(auth), cfg({ destructive: true }));
    expect(summary.actions.skip).toBe(1);
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
});

describe('reap-inert-idp-accounts — fetchReaperFacts (SQL dual-match)', () => {
  it('consulta usuarios (uid OR email degradado) + solicitud activa', async () => {
    const query = vi.fn(async (sql: string, _params?: unknown[]) => {
      if (sql.includes('usuarios')) {
        return { rows: [{ firebase_uid: 'uid-1', email: 'A@x.cl' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    const facts = await fetchReaperFacts(
      { query },
      {
        uid: 'uid-1',
        email: 'A@x.cl',
        providerData: [{ providerId: 'google.com' }],
        creationTime: daysAgo(90),
      },
    );
    expect(facts.usersRows).toEqual([{ firebaseUid: 'uid-1', email: 'A@x.cl' }]);
    expect(facts.solicitudActive).toBe(false);
    // el email se pasa degradado (lowercase+trim) al SQL
    const usuariosCall = query.mock.calls.find((c) => c[0].includes('usuarios'));
    expect(usuariosCall?.[1]).toEqual(['uid-1', 'a@x.cl']);
  });

  it('P0-2: match por email con firebase_uid DISTINTO → usersRows mapeado + isReapable=false (T2b end-to-end)', async () => {
    // La race de account-linking: la fila usuarios existe con un uid distinto
    // al de la cuenta IdP, pero el email (degradado) matchea.
    const query = vi.fn(async (sql: string, _params?: unknown[]) =>
      sql.includes('usuarios')
        ? { rows: [{ firebase_uid: 'uid-OTRO', email: 'inert@x.cl' }], rowCount: 1 }
        : { rows: [], rowCount: 0 },
    );
    const account = {
      uid: 'uid-inert',
      email: 'inert@x.cl',
      providerData: [{ providerId: 'google.com' }],
      creationTime: daysAgo(90),
      lastSignInTime: daysAgo(90),
    };
    const facts = await fetchReaperFacts({ query }, account);
    expect(facts.usersRows).toEqual([{ firebaseUid: 'uid-OTRO', email: 'inert@x.cl' }]);
    // El predicado debe rehusar reapear (hard-guard por email aunque el uid difiera).
    const verdict = isReapable(account, facts, {
      now: NOW,
      graceDays: DEFAULT_REAPER_GRACE_DAYS,
      neverReapable: new Set(),
    });
    expect(verdict.reapable).toBe(false);
    expect(verdict.reason).toMatch(/email/i);
  });

  it('solicitud activa detectada', async () => {
    const query = vi.fn(async (sql: string, _params?: unknown[]) =>
      sql.includes('solicitudes_registro')
        ? { rows: [{ x: 1 }], rowCount: 1 }
        : { rows: [], rowCount: 0 },
    );
    const facts = await fetchReaperFacts(
      { query },
      {
        uid: 'u',
        email: 'a@x.cl',
        providerData: [{ providerId: 'google.com' }],
        creationTime: daysAgo(90),
      },
    );
    expect(facts.solicitudActive).toBe(true);
  });
});
