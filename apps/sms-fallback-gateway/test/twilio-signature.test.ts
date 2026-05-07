import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { validateTwilioSignature } from '../src/twilio-signature.js';

/**
 * Helper para generar una firma válida con la misma lógica de Twilio:
 * concat URL + sortedKeys + values, HMAC-SHA1 con authToken, base64.
 * Usado en los tests para verificar que el validador acepta lo correcto.
 */
function signTwilio(opts: {
  authToken: string;
  url: string;
  params: Record<string, string>;
}): string {
  const sortedKeys = Object.keys(opts.params).sort();
  const concatenated = sortedKeys.reduce((acc, k) => acc + k + opts.params[k], opts.url);
  return crypto.createHmac('sha1', opts.authToken).update(concatenated, 'utf8').digest('base64');
}

describe('validateTwilioSignature — Wave 2 Track B4', () => {
  const authToken = 'test_token_12345_secret';
  const url = 'https://booster-ai-sms-fallback.run.app/webhook';
  const params = {
    AccountSid: 'AC123',
    From: '+5691234567',
    Body: 'BSTR|356307042441013|20260506T100000|-33.0,-70.0|0|1|247',
    MessageSid: 'SM999',
  };

  it('acepta firma válida', () => {
    const signature = signTwilio({ authToken, url, params });
    expect(validateTwilioSignature({ authToken, signature, url, params })).toBe(true);
  });

  it('rechaza firma con auth token diferente', () => {
    const signature = signTwilio({ authToken: 'wrong_token', url, params });
    expect(validateTwilioSignature({ authToken, signature, url, params })).toBe(false);
  });

  it('rechaza firma con URL distinta', () => {
    const signature = signTwilio({ authToken, url: 'https://attacker.com/webhook', params });
    expect(validateTwilioSignature({ authToken, signature, url, params })).toBe(false);
  });

  it('rechaza firma cuando un param se modifica', () => {
    const signature = signTwilio({ authToken, url, params });
    const tamperedParams = { ...params, Body: 'malicious|...|247' };
    expect(validateTwilioSignature({ authToken, signature, url, params: tamperedParams })).toBe(
      false,
    );
  });

  it('rechaza firma cuando se agrega un param', () => {
    const signature = signTwilio({ authToken, url, params });
    const extraParams = { ...params, Extra: 'injected' };
    expect(validateTwilioSignature({ authToken, signature, url, params: extraParams })).toBe(false);
  });

  it('rechaza firma cuando se quita un param', () => {
    const signature = signTwilio({ authToken, url, params });
    const { MessageSid: _, ...minus } = params;
    expect(validateTwilioSignature({ authToken, signature, url, params: minus })).toBe(false);
  });

  it('rechaza firma con length distinta (no leak con timingSafeEqual)', () => {
    expect(
      validateTwilioSignature({
        authToken,
        signature: 'too-short',
        url,
        params,
      }),
    ).toBe(false);
  });

  it('rechaza firma vacía', () => {
    expect(validateTwilioSignature({ authToken, signature: '', url, params })).toBe(false);
  });

  it('rechaza firma con padding base64 corrupto', () => {
    expect(
      validateTwilioSignature({
        authToken,
        signature: '@@@invalid-base64@@@',
        url,
        params,
      }),
    ).toBe(false);
  });

  it('orden de keys del params no afecta la firma (sort interno)', () => {
    const signature = signTwilio({ authToken, url, params });
    const reorderedParams = {
      MessageSid: params.MessageSid,
      Body: params.Body,
      From: params.From,
      AccountSid: params.AccountSid,
    };
    expect(validateTwilioSignature({ authToken, signature, url, params: reorderedParams })).toBe(
      true,
    );
  });
});
