import { describe, expect, it } from 'vitest';
import { redactionPaths } from './redaction.js';

describe('redactionPaths', () => {
  it('incluye credentials core (password, token, api_key, authorization)', () => {
    expect(redactionPaths).toContain('*.password');
    expect(redactionPaths).toContain('*.token');
    expect(redactionPaths).toContain('*.api_key');
    expect(redactionPaths).toContain('*.authorization');
    expect(redactionPaths).toContain('req.headers.authorization');
    expect(redactionPaths).toContain('req.headers.cookie');
  });

  it('incluye PII Ley 19.628 (email, phone, rut, dni, address, fullName)', () => {
    expect(redactionPaths).toContain('*.email');
    expect(redactionPaths).toContain('*.phone');
    expect(redactionPaths).toContain('*.rut');
    expect(redactionPaths).toContain('*.dni');
    expect(redactionPaths).toContain('*.address');
    expect(redactionPaths).toContain('*.fullName');
    expect(redactionPaths).toContain('*.full_name');
  });

  it('cubre ambas convenciones (camelCase y snake_case) para PII', () => {
    expect(redactionPaths).toContain('*.phoneNumber');
    expect(redactionPaths).toContain('*.phone_number');
    expect(redactionPaths).toContain('*.streetAddress');
    expect(redactionPaths).toContain('*.street_address');
    expect(redactionPaths).toContain('*.creditCard');
    expect(redactionPaths).toContain('*.credit_card');
  });

  it('incluye datos de pago (creditCard, cvv, cvc)', () => {
    expect(redactionPaths).toContain('*.creditCard');
    expect(redactionPaths).toContain('*.cvv');
    expect(redactionPaths).toContain('*.cvc');
  });

  it('incluye firmas digitales', () => {
    expect(redactionPaths).toContain('*.signature');
    expect(redactionPaths).toContain('*.digitalSignature');
    expect(redactionPaths).toContain('*.digital_signature');
  });

  it('es un array no vacío y todas las entries son strings', () => {
    expect(redactionPaths.length).toBeGreaterThan(20);
    for (const path of redactionPaths) {
      expect(typeof path).toBe('string');
      expect(path.length).toBeGreaterThan(0);
    }
  });
});
