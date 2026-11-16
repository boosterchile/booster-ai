import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createInvitacionCorreoToken,
  hashInvitacionCorreoToken,
} from './invitar-correo-cuenta-token.js';

/**
 * ADR-093 — token opaco one-shot para `/crear-cuenta`.
 * Rojo exhibido: el módulo no existía; verde = create + hash estables.
 */

describe('invitar-correo-cuenta-token', () => {
  it('emite token opaco ≥32 chars y hash sha256 hex', () => {
    const { token, tokenHash } = createInvitacionCorreoToken();
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('dos emisiones difieren', () => {
    const a = createInvitacionCorreoToken();
    const b = createInvitacionCorreoToken();
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).not.toBe(b.tokenHash);
  });

  it('hashInvitacionCorreoToken es sha256 hex del token', () => {
    expect(hashInvitacionCorreoToken('abc')).toBe(createHash('sha256').update('abc').digest('hex'));
  });
});
