import { describe, expect, it } from 'vitest';
import type { SignupOutcome } from '../lib/signup-client.js';
import { signupFeedback } from './signup-feedback.js';

describe('signupFeedback', () => {
  it('submitted → success (mensaje idéntico, sin pista de enumeration)', () => {
    expect(signupFeedback('submitted')).toEqual({
      tone: 'success',
      message: 'Recibimos tu solicitud. La revisaremos antes de habilitar tu acceso.',
    });
  });

  it.each([
    ['rate_limited', /demasiados intentos/i],
    ['invalid', /revisa los datos/i],
    ['unavailable', /intenta más tarde/i],
    ['network_error', /no pudimos conectar/i],
  ] as const)('%s → error con mensaje legible', (outcome: SignupOutcome, re) => {
    const fb = signupFeedback(outcome);
    expect(fb.tone).toBe('error');
    expect(fb.message).toMatch(re);
  });
});
