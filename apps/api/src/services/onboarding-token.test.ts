import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createOnboardingToken,
  hashOnboardingToken,
  verifyOnboardingToken,
} from './onboarding-token.js';

// >= 32 bytes (256 bits) — la lib exige un secreto fuerte (fail-closed).
const SECRET = 'a-test-signing-secret-with-enough-bytes-xx';
const OTHER_SECRET = 'a-different-secret-with-enough-bytes-yyyyyy';
const SID = '11111111-1111-4111-8111-111111111111';
const HOUR = 3_600_000;

describe('createOnboardingToken', () => {
  it('produce token payload.tag, tokenHash = sha256(token), expiraEn = now+ttl', () => {
    const now = new Date('2026-06-08T00:00:00.000Z');
    const { token, tokenHash, expiraEn } = createOnboardingToken({
      solicitudId: SID,
      ttlMs: HOUR,
      secret: SECRET,
      now,
    });
    expect(token.split('.')).toHaveLength(2);
    expect(tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(expiraEn.getTime()).toBe(now.getTime() + HOUR);
  });

  it('dos tokens para la misma solicitud difieren (nonce + tokenHash)', () => {
    const a = createOnboardingToken({ solicitudId: SID, ttlMs: HOUR, secret: SECRET });
    const b = createOnboardingToken({ solicitudId: SID, ttlMs: HOUR, secret: SECRET });
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).not.toBe(b.tokenHash);
  });

  it('lanza si el secreto es débil (<32 bytes) — fail-closed', () => {
    expect(() =>
      createOnboardingToken({ solicitudId: SID, ttlMs: HOUR, secret: 'short' }),
    ).toThrow();
  });

  it('lanza si ttlMs no es entero positivo finito', () => {
    expect(() => createOnboardingToken({ solicitudId: SID, ttlMs: 0, secret: SECRET })).toThrow();
    expect(() => createOnboardingToken({ solicitudId: SID, ttlMs: -1, secret: SECRET })).toThrow();
    expect(() => createOnboardingToken({ solicitudId: SID, ttlMs: 1.5, secret: SECRET })).toThrow();
    expect(() =>
      createOnboardingToken({
        solicitudId: SID,
        ttlMs: Number.POSITIVE_INFINITY,
        secret: SECRET,
      }),
    ).toThrow();
  });

  it('lanza si solicitudId es vacío', () => {
    expect(() => createOnboardingToken({ solicitudId: '', ttlMs: HOUR, secret: SECRET })).toThrow();
  });
});

describe('verifyOnboardingToken', () => {
  it('round-trip: token recién creado verifica ok con su sid y expiraEn', () => {
    const now = new Date('2026-06-08T00:00:00.000Z');
    const { token, expiraEn } = createOnboardingToken({
      solicitudId: SID,
      ttlMs: HOUR,
      secret: SECRET,
      now,
    });
    const res = verifyOnboardingToken({ token, secret: SECRET, now });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.solicitudId).toBe(SID);
      expect(res.expiraEn.getTime()).toBe(expiraEn.getTime());
    }
  });

  it('expirado: now > exp => reason expired', () => {
    const now = new Date('2026-06-08T00:00:00.000Z');
    const { token } = createOnboardingToken({ solicitudId: SID, ttlMs: HOUR, secret: SECRET, now });
    const later = new Date(now.getTime() + HOUR + 1);
    expect(verifyOnboardingToken({ token, secret: SECRET, now: later })).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('borde now == exp => expired (rechazo inclusivo)', () => {
    const now = new Date('2026-06-08T00:00:00.000Z');
    const { token, expiraEn } = createOnboardingToken({
      solicitudId: SID,
      ttlMs: HOUR,
      secret: SECRET,
      now,
    });
    expect(verifyOnboardingToken({ token, secret: SECRET, now: expiraEn })).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('secreto distinto => invalid', () => {
    const { token } = createOnboardingToken({ solicitudId: SID, ttlMs: HOUR, secret: SECRET });
    expect(verifyOnboardingToken({ token, secret: OTHER_SECRET })).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('payload manipulado => invalid', () => {
    const { token } = createOnboardingToken({ solicitudId: SID, ttlMs: HOUR, secret: SECRET });
    const parts = token.split('.');
    const payload = parts[0] ?? '';
    const tag = parts[1] ?? '';
    const flipped = (payload[0] === 'A' ? 'B' : 'A') + payload.slice(1);
    expect(verifyOnboardingToken({ token: `${flipped}.${tag}`, secret: SECRET })).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('tag manipulado => invalid', () => {
    const { token } = createOnboardingToken({ solicitudId: SID, ttlMs: HOUR, secret: SECRET });
    const parts = token.split('.');
    const payload = parts[0] ?? '';
    const tag = parts[1] ?? '';
    const flipped = (tag[0] === 'A' ? 'B' : 'A') + tag.slice(1);
    expect(verifyOnboardingToken({ token: `${payload}.${flipped}`, secret: SECRET })).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('firma se verifica ANTES que expiración: token con firma inválida y vencido => invalid (no expired)', () => {
    const now = new Date('2026-06-08T00:00:00.000Z');
    // firmado con OTHER_SECRET => firma no valida contra SECRET
    const { token } = createOnboardingToken({
      solicitudId: SID,
      ttlMs: HOUR,
      secret: OTHER_SECRET,
      now,
    });
    const later = new Date(now.getTime() + HOUR + 1); // además vencido
    // No debe revelar 'expired' (oráculo) para un token cuya firma no valida.
    expect(verifyOnboardingToken({ token, secret: SECRET, now: later })).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('tokens malformados nunca lanzan, retornan invalid', () => {
    for (const bad of ['', 'sinpunto', 'a.b.c', '.', 'a.', '.b', '!!!.???', 'a.b']) {
      const res = verifyOnboardingToken({ token: bad, secret: SECRET });
      expect(res.ok).toBe(false);
    }
  });

  it('lanza si el secreto es débil (config error, no input atacante)', () => {
    const { token } = createOnboardingToken({ solicitudId: SID, ttlMs: HOUR, secret: SECRET });
    expect(() => verifyOnboardingToken({ token, secret: 'short' })).toThrow();
  });
});

describe('hashOnboardingToken', () => {
  it('es sha256 hex determinístico del token', () => {
    expect(hashOnboardingToken('abc')).toBe(createHash('sha256').update('abc').digest('hex'));
    expect(hashOnboardingToken('abc')).toBe(hashOnboardingToken('abc'));
    expect(hashOnboardingToken('abc')).toMatch(/^[0-9a-f]{64}$/);
  });
});
