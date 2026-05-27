import { describe, expect, it } from 'vitest';
import { normalizeEmail } from './email-normalize.js';

/**
 * Sprint 2c-A T5 — R-2C-9 (email normalization risk) coverage.
 *
 * 22 variants covering: casing, whitespace, NFC/NFD equivalence, IDN
 * domains, punycode-encoded domains, mixed-case punycode, gmail-specific
 * patterns explicitly NOT collapsed, multi-`@` parsing, empty input.
 */

describe('normalizeEmail — canonical forms', () => {
  it('canonical lowercase input stays unchanged', () => {
    expect(normalizeEmail('foo@bar.com')).toBe('foo@bar.com');
  });

  it('uppercase email is lowercased', () => {
    expect(normalizeEmail('FOO@BAR.COM')).toBe('foo@bar.com');
  });

  it('mixed case email is lowercased', () => {
    expect(normalizeEmail('Foo@BAR.com')).toBe('foo@bar.com');
  });

  it('local-part preserves dots (no gmail collapse)', () => {
    expect(normalizeEmail('foo.bar@gmail.com')).toBe('foo.bar@gmail.com');
  });

  it('local-part preserves plus alias (no gmail strip)', () => {
    expect(normalizeEmail('first+last@gmail.com')).toBe('first+last@gmail.com');
  });

  it('local-part preserves multi-dot + plus', () => {
    expect(normalizeEmail('f.o.o+anything@gmail.com')).toBe('f.o.o+anything@gmail.com');
  });
});

describe('normalizeEmail — whitespace', () => {
  it('strips leading whitespace', () => {
    expect(normalizeEmail('  foo@bar.com')).toBe('foo@bar.com');
  });

  it('strips trailing whitespace', () => {
    expect(normalizeEmail('foo@bar.com  ')).toBe('foo@bar.com');
  });

  it('strips leading + trailing whitespace', () => {
    expect(normalizeEmail('  foo@bar.com  ')).toBe('foo@bar.com');
  });

  it('strips trailing newline', () => {
    expect(normalizeEmail('foo@bar.com\n')).toBe('foo@bar.com');
  });

  it('strips trailing tab', () => {
    expect(normalizeEmail('foo@bar.com\t')).toBe('foo@bar.com');
  });
});

describe('normalizeEmail — Unicode NFC vs NFD', () => {
  it('NFD-decomposed local-part normalizes to NFC', () => {
    // 'café' in NFD: 'c' + 'a' + 'f' + 'e' + combining-acute (U+0301)
    const nfd = `cafe${String.fromCharCode(0x0301)}@bar.com`;
    const nfc = 'café@bar.com';
    expect(normalizeEmail(nfd)).toBe(nfc);
    expect(normalizeEmail(nfd).normalize('NFC')).toBe(nfc);
  });

  it('NFC input remains in NFC form', () => {
    expect(normalizeEmail('José@bar.com')).toBe('josé@bar.com');
  });
});

describe('normalizeEmail — IDN domains', () => {
  it('Unicode IDN domain preserved (and lowercased)', () => {
    expect(normalizeEmail('foo@müller.de')).toBe('foo@müller.de');
  });

  it('punycode-encoded domain decoded to Unicode', () => {
    expect(normalizeEmail('foo@xn--mller-kva.de')).toBe('foo@müller.de');
  });

  it('uppercase punycode (after lowercase + decode) returns Unicode', () => {
    expect(normalizeEmail('foo@XN--MLLER-KVA.DE')).toBe('foo@müller.de');
  });

  it('punycode label in subdomain decodes correctly', () => {
    expect(normalizeEmail('foo@xn--mller-kva.example.com')).toBe('foo@müller.example.com');
  });

  it('numeric IP-like domain preserved (no IDN decode)', () => {
    expect(normalizeEmail('foo@192.168.1.1')).toBe('foo@192.168.1.1');
  });
});

describe('normalizeEmail — edge cases', () => {
  it('empty string returns empty string', () => {
    expect(normalizeEmail('')).toBe('');
  });

  it('whitespace-only returns empty after trim', () => {
    expect(normalizeEmail('   \t\n  ')).toBe('');
  });

  it('input without `@` returns lowercased + trimmed', () => {
    expect(normalizeEmail('  Foo  ')).toBe('foo');
  });

  it('input with multiple `@` splits at the last one', () => {
    // Quoted local-parts with `@` are valid per RFC 5321 §4.1.2.
    expect(normalizeEmail('"a@b"@example.com')).toBe('"a@b"@example.com');
  });
});
