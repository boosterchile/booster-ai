import { describe, expect, it } from 'vitest';
import { redactObjectValues, redactValue } from './redaction.js';

describe('redactValue — email patterns (T4 SC-H4.1)', () => {
  it('email simple → [REDACTED:email]', () => {
    expect(redactValue('contacto: user@example.com')).toBe('contacto: [REDACTED:email]');
  });

  it('email con + tag → [REDACTED:email]', () => {
    expect(redactValue('user+tag@booster-ai.com')).toBe('[REDACTED:email]');
  });

  it('múltiples emails en mismo string → todos redactados', () => {
    expect(redactValue('A: a@x.com, B: b@y.com')).toBe('A: [REDACTED:email], B: [REDACTED:email]');
  });

  it('no email → passthrough', () => {
    expect(redactValue('plain text without PII')).toBe('plain text without PII');
  });
});

describe('redactValue — JWT patterns', () => {
  it('JWT 3 segments base64 → [REDACTED:jwt]', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyMSJ9.signaturepart';
    expect(redactValue(`Bearer ${jwt}`)).toBe('Bearer [REDACTED:jwt]');
  });

  it('NO redacta strings con dots pero no JWT shape', () => {
    expect(redactValue('version: 1.2.3 minor.patch.release')).toBe(
      'version: 1.2.3 minor.patch.release',
    );
  });
});

describe('redactValue — RUT patterns (con módulo-11 validation)', () => {
  it('RUT válido formato canónico → [REDACTED:rut]', () => {
    expect(redactValue('cliente: 11111111-1')).toBe('cliente: [REDACTED:rut]');
  });

  it('RUT válido sin guión → [REDACTED:rut]', () => {
    expect(redactValue('rut 111111111')).toBe('rut [REDACTED:rut]');
  });

  it('RUT con DV K minúscula → [REDACTED:rut] (módulo-11 reconoce K)', () => {
    // 5000001-K es válido (módulo-11 verified: body=5000001, sum=12, rem=1 → DV=K)
    expect(redactValue('rut 5000001-k')).toBe('rut [REDACTED:rut]');
  });

  it('número que parece RUT pero módulo-11 inválido → NO redacta (false positive avoidance)', () => {
    // 12345678-9 tiene DV inválido (real DV is 5)
    expect(redactValue('código 12345678-9')).toBe('código 12345678-9');
  });

  it('números cortos no-RUT → passthrough', () => {
    expect(redactValue('123 456')).toBe('123 456');
  });
});

describe('redactValue — phone patterns (T5 SC-H4.1, validated via normalizePhone)', () => {
  it('móvil con +56 prefix y spaces → [REDACTED:phone]', () => {
    expect(redactValue('tel: +56 9 1234 5678')).toBe('tel: [REDACTED:phone]');
  });

  it('móvil 9-digit sin prefix → [REDACTED:phone]', () => {
    expect(redactValue('contact 912345678 urgent')).toBe('contact [REDACTED:phone] urgent');
  });

  it('móvil 11-digit con 56 sin + → [REDACTED:phone]', () => {
    expect(redactValue('phone 56912345678')).toBe('phone [REDACTED:phone]');
  });

  it('móvil con dashes → [REDACTED:phone]', () => {
    expect(redactValue('llamar +56-9-1234-5678')).toBe('llamar [REDACTED:phone]');
  });

  it('móvil con parens → [REDACTED:phone]', () => {
    expect(redactValue('cell +56 (9) 12345678')).toBe('cell [REDACTED:phone]');
  });

  it('múltiples phones en string → todos redactados', () => {
    expect(redactValue('A: +56912345678, B: 956789012')).toBe(
      'A: [REDACTED:phone], B: [REDACTED:phone]',
    );
  });

  it('phone internacional NO-Chile → NO redacta (false positive avoidance)', () => {
    expect(redactValue('US tel +1 234 567 8900')).toBe('US tel +1 234 567 8900');
  });

  it('número que no es phone Chile → passthrough', () => {
    expect(redactValue('precio $1234567')).toBe('precio $1234567');
  });

  it('RUT válido NO se confunde con phone (RUT check viene antes)', () => {
    // 11111111-1 es RUT válido (DV=1). Debe redactarse como :rut, no :phone.
    expect(redactValue('cliente 11111111-1')).toBe('cliente [REDACTED:rut]');
  });
});

describe('redactObjectValues — recursive walk', () => {
  it('flat object con sensitive key (matchea /pass|secret|token|key/i) → value redacted', () => {
    const input = { username: 'alice', password: 'p4ssw0rd' };
    const out = redactObjectValues(input) as Record<string, unknown>;
    expect(out.username).toBe('alice');
    expect(out.password).toBe('[REDACTED:password]');
  });

  it('keys con secret/token/key/auth case-insensitive → redacted', () => {
    const input = {
      apiSecret: 'abc',
      access_token: 'xyz',
      MY_KEY: 'def',
      authHeader: 'ghi',
    };
    const out = redactObjectValues(input) as Record<string, unknown>;
    expect(out.apiSecret).toBe('[REDACTED:password]');
    expect(out.access_token).toBe('[REDACTED:password]');
    expect(out.MY_KEY).toBe('[REDACTED:password]');
    expect(out.authHeader).toBe('[REDACTED:password]');
  });

  it('nested objects → recursion redacta deep', () => {
    const input = {
      user: { name: 'alice', email: 'alice@x.com' },
      meta: { trace: 'plain text' },
    };
    const out = redactObjectValues(input) as {
      user: { name: string; email: string };
      meta: { trace: string };
    };
    expect(out.user.name).toBe('alice');
    expect(out.user.email).toBe('[REDACTED:email]');
    expect(out.meta.trace).toBe('plain text');
  });

  it('arrays → walks element por element', () => {
    const input = {
      messages: ['hello', 'contact me at bob@x.com', 'plain'],
    };
    const out = redactObjectValues(input) as { messages: string[] };
    expect(out.messages).toEqual(['hello', 'contact me at [REDACTED:email]', 'plain']);
  });

  it('circular reference → no infinite loop', () => {
    const circular: { self?: unknown; msg: string } = { msg: 'safe' };
    circular.self = circular;
    expect(() => redactObjectValues(circular)).not.toThrow();
  });

  it('null y undefined values → passthrough', () => {
    const input = { a: null, b: undefined, c: 'plain' };
    const out = redactObjectValues(input) as Record<string, unknown>;
    expect(out.a).toBeNull();
    expect(out.b).toBeUndefined();
    expect(out.c).toBe('plain');
  });

  it('numbers y booleans → passthrough', () => {
    const input = { count: 42, active: true, name: 'plain' };
    const out = redactObjectValues(input) as Record<string, unknown>;
    expect(out.count).toBe(42);
    expect(out.active).toBe(true);
    expect(out.name).toBe('plain');
  });

  it('email dentro de field name no-sensitive → redactado por value match', () => {
    // Field name 'note' no es sensitive (no matchea /pass|secret|token|key|auth/i),
    // pero el value contiene email → value-based regex lo detecta.
    const input = { note: 'Contact: user@example.com for support' };
    const out = redactObjectValues(input) as { note: string };
    expect(out.note).toBe('Contact: [REDACTED:email] for support');
  });
});
