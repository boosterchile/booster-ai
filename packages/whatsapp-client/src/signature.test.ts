import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyMetaSignature } from './signature.js';

function makeSignature(body: string, secret: string): string {
  const hex = createHmac('sha256', secret).update(body).digest('hex');
  return `sha256=${hex}`;
}

describe('verifyMetaSignature', () => {
  const body = '{"hello":"world"}';
  const secret = 'test_app_secret_123';

  it('accepts valid signature', () => {
    const sig = makeSignature(body, secret);
    expect(verifyMetaSignature(body, sig, secret)).toBe(true);
  });

  it('rejects missing header', () => {
    expect(verifyMetaSignature(body, undefined, secret)).toBe(false);
  });

  it('rejects wrong prefix', () => {
    const sig = makeSignature(body, secret).replace('sha256=', 'sha1=');
    expect(verifyMetaSignature(body, sig, secret)).toBe(false);
  });

  it('rejects tampered body', () => {
    const sig = makeSignature(body, secret);
    expect(verifyMetaSignature('{"tampered":true}', sig, secret)).toBe(false);
  });

  it('rejects wrong secret', () => {
    const sig = makeSignature(body, 'other_secret');
    expect(verifyMetaSignature(body, sig, secret)).toBe(false);
  });

  it('rejects malformed hex in signature', () => {
    expect(verifyMetaSignature(body, 'sha256=not-hex-at-all', secret)).toBe(false);
  });

  it('rejects wrong length hex (< 64 chars)', () => {
    expect(verifyMetaSignature(body, 'sha256=abc123', secret)).toBe(false);
  });
});
