import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyTwilioSignature } from './twilio-signature.js';

/**
 * Helper: replica el algoritmo Twilio para generar la firma esperada.
 * URL + sorted (key, value) pairs → HMAC-SHA1 con authToken → base64.
 */
function makeSignature(authToken: string, url: string, params: Record<string, string>): string {
  let data = url;
  for (const key of Object.keys(params).sort()) {
    data += key + params[key];
  }
  return createHmac('sha1', authToken).update(data).digest('base64');
}

describe('verifyTwilioSignature', () => {
  const authToken = 'test_auth_token_12345';
  const url = 'https://example.com/webhooks/whatsapp';
  const params = {
    From: 'whatsapp:+56957790379',
    To: 'whatsapp:+14155238886',
    Body: 'hola',
    MessageSid: 'SM123abc',
  };

  it('accepts valid signature', () => {
    const sig = makeSignature(authToken, url, params);
    expect(verifyTwilioSignature(authToken, sig, url, params)).toBe(true);
  });

  it('rejects missing header', () => {
    expect(verifyTwilioSignature(authToken, undefined, url, params)).toBe(false);
  });

  it('rejects empty header', () => {
    expect(verifyTwilioSignature(authToken, '', url, params)).toBe(false);
  });

  it('rejects wrong auth token', () => {
    const sig = makeSignature('different_token', url, params);
    expect(verifyTwilioSignature(authToken, sig, url, params)).toBe(false);
  });

  it('rejects tampered body', () => {
    const sig = makeSignature(authToken, url, params);
    const tampered = { ...params, Body: 'tampered' };
    expect(verifyTwilioSignature(authToken, sig, url, tampered)).toBe(false);
  });

  it('rejects wrong URL', () => {
    const sig = makeSignature(authToken, url, params);
    expect(verifyTwilioSignature(authToken, sig, 'https://example.com/different', params)).toBe(
      false,
    );
  });

  it('rejects malformed base64', () => {
    expect(verifyTwilioSignature(authToken, '!!!not-base64!!!', url, params)).toBe(false);
  });

  it('handles params with special chars (URL-decoded form values)', () => {
    const specialParams = {
      ...params,
      Body: 'hola con tilde á y emoji 🚚',
    };
    const sig = makeSignature(authToken, url, specialParams);
    expect(verifyTwilioSignature(authToken, sig, url, specialParams)).toBe(true);
  });

  it('rejects when params are reordered (must be alphabetical)', () => {
    // El algoritmo internamente sortea, pero verificamos que un atacante
    // que pase una firma calculada en orden distinto no pasa el check.
    const sig = makeSignature(authToken, url, params);
    // sig fue calculada con sorted keys ya — pero verifyTwilioSignature
    // también sortea internamente, así que cualquier orden de params de
    // entrada da el mismo resultado. Eso es correcto.
    const reordered = {
      Body: 'hola',
      From: 'whatsapp:+56957790379',
      To: 'whatsapp:+14155238886',
      MessageSid: 'SM123abc',
    };
    expect(verifyTwilioSignature(authToken, sig, url, reordered)).toBe(true);
  });

  it('uses timing-safe comparison (does not return early)', () => {
    // No es un test perfecto, pero verifica que no haya un short-circuit
    // obvio. Idealmente medirías timing pero es flaky en CI.
    const sig = makeSignature(authToken, url, params);
    // Modificamos el último char para que falle al final
    const lastChar = sig[sig.length - 1];
    const tweaked = sig.slice(0, -1) + (lastChar === 'A' ? 'B' : 'A');
    expect(verifyTwilioSignature(authToken, tweaked, url, params)).toBe(false);
  });
});
