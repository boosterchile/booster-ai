import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REAPER_GRACE_DAYS,
  type ReaperConfig,
  type ReaperFacts,
  type ReaperIdpAccount,
  isReapable,
  normalizeReaperEmail,
} from './reaper-predicate.js';

/**
 * Tests para T7 / SC-G3 — predicado puro del reaper.
 *
 * TDD-mandatory (integridad de datos: el verdadero `reapable=true` lleva a
 * disable/delete de cuentas). Cubre el dual-guard (uid+email), el grace
 * (creationTime + lastSignInTime), la exclusión pending/aprobado, el scope
 * Google-only+email (OQ-G3) y el match degradado lowercase+trim (OQ-G6).
 *
 * Mapea a los tests del spec §10: T1, T2, T2b, T3, T4, T5, T5b, T11.
 */

const NOW = new Date('2026-06-04T00:00:00Z');
const GOOGLE = [{ providerId: 'google.com' }];

const cfg = (overrides: Partial<ReaperConfig> = {}): ReaperConfig => ({
  now: NOW,
  graceDays: DEFAULT_REAPER_GRACE_DAYS,
  neverReapable: new Set(['dev@boosterchile.com']),
  ...overrides,
});

// Una fecha N días antes de NOW, en ISO.
const daysAgo = (n: number): string => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const agedAccount = (overrides: Partial<ReaperIdpAccount> = {}): ReaperIdpAccount => ({
  uid: 'uid-inert',
  email: 'inert@x.cl',
  providerData: GOOGLE,
  creationTime: daysAgo(90),
  lastSignInTime: daysAgo(90),
  ...overrides,
});

const noMatch: ReaperFacts = { usersRows: [], solicitudActive: false };

describe('reaper-predicate — normalizeReaperEmail (OQ-G6)', () => {
  it('lowercase + trim', () => {
    expect(normalizeReaperEmail('  Foo@X.CL ')).toBe('foo@x.cl');
  });
  it('NO colapsa plus-tags ni dots', () => {
    expect(normalizeReaperEmail('a+tag@x.cl')).toBe('a+tag@x.cl');
  });
});

describe('reaper-predicate — isReapable', () => {
  it('T1: INERT + aged (creation+lastSignIn) + sin users + sin solicitud → reapable', () => {
    const v = isReapable(agedAccount(), noMatch, cfg());
    expect(v.reapable).toBe(true);
    expect(v.reason).toMatch(/INERT/);
  });

  it('dual-guard: uid Y email matchean a la vez → no reapada, reason uid+email (P2-2)', () => {
    const facts: ReaperFacts = {
      usersRows: [{ firebaseUid: 'uid-inert', email: 'inert@x.cl' }],
      solicitudActive: false,
    };
    const v = isReapable(agedAccount(), facts, cfg());
    expect(v.reapable).toBe(false);
    expect(v.reason).toMatch(/uid\+email/);
  });

  it('scope OQ-G3: email solo-whitespace → fuera de scope, no reapada (P2-1)', () => {
    const acc = agedAccount({ email: '   ' });
    expect(isReapable(acc, noMatch, cfg()).reapable).toBe(false);
  });

  it('graceDays=0 → cuenta añeja por 1 día es reapable (config explícita, P1-2)', () => {
    const acc = agedAccount({ creationTime: daysAgo(1), lastSignInTime: daysAgo(1) });
    expect(isReapable(acc, noMatch, cfg({ graceDays: 0 })).reapable).toBe(true);
  });

  it('graceDays=NaN (env corrupta) → fail-safe: no reapada (P1-2)', () => {
    expect(isReapable(agedAccount(), noMatch, cfg({ graceDays: Number.NaN })).reapable).toBe(false);
  });

  it('creationTime con fecha inválida → fail-safe: no reapada', () => {
    const acc = agedAccount({ creationTime: 'not-a-date' });
    expect(isReapable(acc, noMatch, cfg()).reapable).toBe(false);
  });

  it('T2: fila users por uid → NUNCA reapada (hard-guard)', () => {
    const facts: ReaperFacts = {
      usersRows: [{ firebaseUid: 'uid-inert', email: 'otro@x.cl' }],
      solicitudActive: false,
    };
    expect(isReapable(agedAccount(), facts, cfg()).reapable).toBe(false);
  });

  it('T2b: fila users por email (uid distinto, post account-linking) → NUNCA reapada', () => {
    const facts: ReaperFacts = {
      usersRows: [{ firebaseUid: 'uid-OTRO', email: 'inert@x.cl' }],
      solicitudActive: false,
    };
    const v = isReapable(agedAccount(), facts, cfg());
    expect(v.reapable).toBe(false);
    expect(v.reason).toMatch(/email/i);
  });

  it('T3: solicitud pendiente_aprobacion → no reapada', () => {
    const facts: ReaperFacts = { usersRows: [], solicitudActive: true };
    expect(isReapable(agedAccount(), facts, cfg()).reapable).toBe(false);
  });

  it('T4: solicitud aprobado (users row aún no creada) → no reapada', () => {
    const facts: ReaperFacts = { usersRows: [], solicitudActive: true };
    expect(isReapable(agedAccount(), facts, cfg()).reapable).toBe(false);
  });

  it('T5: inert pero creationTime dentro de grace → no reapada', () => {
    const acc = agedAccount({ creationTime: daysAgo(10), lastSignInTime: daysAgo(90) });
    expect(isReapable(acc, noMatch, cfg()).reapable).toBe(false);
  });

  it('T5b: lastSignInTime dentro de grace → no reapada (cuenta activa)', () => {
    const acc = agedAccount({ creationTime: daysAgo(90), lastSignInTime: daysAgo(5) });
    const v = isReapable(acc, noMatch, cfg());
    expect(v.reapable).toBe(false);
    expect(v.reason).toMatch(/grace/i);
  });

  it('T11: match email degradado Foo@x.cl ≡ foo@x.cl (uid distinto) → no reapada', () => {
    const acc = agedAccount({ email: 'Foo@x.cl' });
    const facts: ReaperFacts = {
      usersRows: [{ firebaseUid: 'uid-OTRO', email: 'foo@x.cl' }],
      solicitudActive: false,
    };
    expect(isReapable(acc, facts, cfg()).reapable).toBe(false);
  });

  it('T11: el match NO colapsa plus-tags (a@x.cl NO matchea a+tag@x.cl) → reapable', () => {
    const acc = agedAccount({ email: 'a+tag@x.cl' });
    const facts: ReaperFacts = {
      usersRows: [{ firebaseUid: 'uid-OTRO', email: 'a@x.cl' }],
      solicitudActive: false,
    };
    expect(isReapable(acc, facts, cfg()).reapable).toBe(true);
  });

  it('never-reapable (dev@boosterchile.com) aunque inert+aged → no reapada', () => {
    const acc = agedAccount({ email: 'DEV@boosterchile.com' });
    const v = isReapable(acc, noMatch, cfg());
    expect(v.reapable).toBe(false);
    expect(v.reason).toMatch(/never-reapable/i);
  });

  it('scope OQ-G3: provider no-google (phone) → no reapada (fuera de scope, R-G8)', () => {
    const acc = agedAccount({ providerData: [{ providerId: 'phone' }] });
    expect(isReapable(acc, noMatch, cfg()).reapable).toBe(false);
  });

  it('scope OQ-G3: Google sin email → no reapada (R-G8)', () => {
    const acc = agedAccount({ email: null });
    expect(isReapable(acc, noMatch, cfg()).reapable).toBe(false);
  });

  it('lastSignInTime ausente → conservador: no reapada (no se puede confirmar inactividad)', () => {
    const acc = agedAccount({ lastSignInTime: null });
    expect(isReapable(acc, noMatch, cfg()).reapable).toBe(false);
  });

  it('creationTime exactamente en el límite del grace → no reapada (estricto: > grace)', () => {
    const acc = agedAccount({
      creationTime: daysAgo(DEFAULT_REAPER_GRACE_DAYS),
      lastSignInTime: daysAgo(90),
    });
    expect(isReapable(acc, noMatch, cfg()).reapable).toBe(false);
  });

  it('default grace = 30 días', () => {
    expect(DEFAULT_REAPER_GRACE_DAYS).toBe(30);
  });
});
