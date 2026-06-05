import { describe, expect, it, vi } from 'vitest';
import {
  NEVER_REAPABLE_EMAILS,
  classifyAccount,
  classifyGoogleIdpAccounts,
  isGoogleWithEmail,
  normalizeEmailDegraded,
  toMarkdownReport,
} from '../../scripts/classify-google-idp-accounts.js';

/**
 * Tests para T4 / SC-G2 — clasificación de cuentas IdP Google existentes.
 *
 * Funciones puras del cross-ref (LEGITIMATE/PENDING/INERT). El IO
 * (listUsers paginado + queries) se ejerce contra prod en el run
 * operacional, no acá.
 *
 * Decisiones OQ (oq-resolution.md): G3 Google-only+email-present;
 * G6 match degradado lowercase+trim (inclusivo, no canónico).
 */

describe('classify-google-idp-accounts — normalizeEmailDegraded (OQ-G6)', () => {
  it('lowercase + trim (forma guardada degradada)', () => {
    expect(normalizeEmailDegraded('  Foo@X.CL  ')).toBe('foo@x.cl');
  });

  it('NO colapsa dots ni plus-tags (el dato no los canonicalizó)', () => {
    expect(normalizeEmailDegraded('f.o.o+tag@gmail.com')).toBe('f.o.o+tag@gmail.com');
  });
});

describe('classify-google-idp-accounts — isGoogleWithEmail (OQ-G3 scope)', () => {
  const google = { providerId: 'google.com' };
  const phone = { providerId: 'phone' };

  it('Google provider + email presente → true', () => {
    expect(isGoogleWithEmail({ email: 'a@x.cl', providerData: [google] })).toBe(true);
  });

  it('Google provider sin email → false', () => {
    expect(isGoogleWithEmail({ email: null, providerData: [google] })).toBe(false);
  });

  it('sin Google provider → false (excluye phone/SAML — elimina R-G8)', () => {
    expect(isGoogleWithEmail({ email: 'a@x.cl', providerData: [phone] })).toBe(false);
  });

  it('múltiples providers incluyendo google → true', () => {
    expect(isGoogleWithEmail({ email: 'a@x.cl', providerData: [phone, google] })).toBe(true);
  });
});

describe('classify-google-idp-accounts — classifyAccount', () => {
  const base = {
    email: 'user@x.cl',
    uidMatch: false,
    emailMatch: false,
    solicitudActive: false,
    neverReapable: new Set<string>(),
  };

  it('match por uid → LEGITIMATE', () => {
    expect(classifyAccount({ ...base, uidMatch: true }).classification).toBe('LEGITIMATE');
  });

  it('match por email (degradado) → LEGITIMATE', () => {
    expect(classifyAccount({ ...base, emailMatch: true }).classification).toBe('LEGITIMATE');
  });

  it('sin users row pero con solicitud activa → PENDING', () => {
    expect(classifyAccount({ ...base, solicitudActive: true }).classification).toBe('PENDING');
  });

  it('sin users row ni solicitud → INERT (candidato reaper)', () => {
    expect(classifyAccount(base).classification).toBe('INERT');
  });

  it('never-reapable gana incluso sin users row → LEGITIMATE', () => {
    const result = classifyAccount({
      ...base,
      email: 'dev@boosterchile.com',
      neverReapable: new Set(['dev@boosterchile.com']),
    });
    expect(result.classification).toBe('LEGITIMATE');
    expect(result.reason).toMatch(/never-reapable/i);
  });

  it('never-reapable compara en forma degradada (case-insensitive)', () => {
    const result = classifyAccount({
      ...base,
      email: 'DEV@Boosterchile.com',
      neverReapable: new Set(['dev@boosterchile.com']),
    });
    expect(result.classification).toBe('LEGITIMATE');
  });

  it('dev@boosterchile.com está en el allowlist por defecto', () => {
    expect(NEVER_REAPABLE_EMAILS.has('dev@boosterchile.com')).toBe(true);
  });
});

describe('classify-google-idp-accounts — toMarkdownReport', () => {
  const rows = [
    {
      firebaseUid: 'uid-1',
      email: 'a@x.cl',
      displayName: 'A',
      createdAt: '2026-01-01T00:00:00Z',
      lastSignInAt: '2026-05-01T00:00:00Z',
      classification: 'LEGITIMATE' as const,
      reason: 'users row',
    },
    {
      firebaseUid: 'uid-2',
      email: 'b@x.cl',
      displayName: '',
      createdAt: '2026-02-01T00:00:00Z',
      lastSignInAt: '2026-02-02T00:00:00Z',
      classification: 'INERT' as const,
      reason: 'sin users row + sin solicitud',
    },
  ];

  it('incluye conteo por categoría (celda exacta)', () => {
    const md = toMarkdownReport(rows);
    expect(md).toContain('| LEGITIMATE | 1 |');
    expect(md).toContain('| INERT | 1 |');
    expect(md).toContain('| **Total** | **2** |');
  });

  it('incluye una columna de decisión PO para los INERT', () => {
    const md = toMarkdownReport(rows);
    expect(md).toMatch(/uid-2/);
    expect(md.toLowerCase()).toContain('decisión po');
  });

  it('escapa pipes en displayName para no romper la tabla markdown', () => {
    const md = toMarkdownReport([{ ...rows[0], displayName: 'A | B', firebaseUid: 'uid-3' }]);
    expect(md).not.toMatch(/A \| B/);
  });

  it('escapa el backslash ANTES del pipe (CodeQL js/incomplete-sanitization)', () => {
    // displayName/email son controlados por el usuario: un `\` no escapado dejaría
    // el escaping de `|` reversible e inyectable. El backslash debe ir a `\\`.
    const md = toMarkdownReport([{ ...rows[0], displayName: 'A\\|B', firebaseUid: 'uid-4' }]);
    // El `\` se duplica y el `|` queda escapado por su propio backslash → 3 backslashes + `|`.
    expect(md).toContain('A\\\\\\|B');
    // No debe quedar la forma ambigua de 2 backslashes que producía el escaping incompleto.
    expect(md).not.toContain('A\\\\|B');
  });
});

describe('classify-google-idp-accounts — classifyGoogleIdpAccounts (IO paginado, P1-3)', () => {
  it('>1000 cuentas → listado paginado completo sin orphans + SQL con email degradado', async () => {
    const users = Array.from({ length: 2500 }, (_, i) => ({
      uid: `uid-${i}`,
      email: `U${i}@X.cl`,
      displayName: '',
      providerData: [{ providerId: 'google.com' }],
      metadata: { creationTime: '2026-01-01T00:00:00Z', lastSignInTime: '2026-01-01T00:00:00Z' },
    }));
    const listUsers = vi.fn(async (_max: number, pageToken?: string) => {
      const start = pageToken ? Number(pageToken) : 0;
      const slice = users.slice(start, start + 1000);
      const next = start + 1000 < users.length ? String(start + 1000) : undefined;
      return { users: slice, pageToken: next };
    });
    // Sin filas usuarios ni solicitud → todas INERT.
    const query = vi.fn(async (_sql: string, _params?: unknown[]) => ({ rows: [], rowCount: 0 }));

    const result = await classifyGoogleIdpAccounts({ listUsers }, { query });

    expect(result).toHaveLength(2500);
    expect(result.every((r) => r.classification === 'INERT')).toBe(true);
    expect(listUsers).toHaveBeenCalledTimes(3); // 1000 + 1000 + 500
    // el email se pasa degradado (lowercase+trim) al SQL de usuarios
    const usuariosCall = query.mock.calls.find((c) => c[0].includes('usuarios'));
    expect(usuariosCall?.[1]).toEqual(['uid-0', 'u0@x.cl']);
  });

  it('cuenta con fila usuarios → LEGITIMATE (no INERT)', async () => {
    const listUsers = vi.fn(async () => ({
      users: [
        {
          uid: 'uid-leg',
          email: 'leg@x.cl',
          displayName: '',
          providerData: [{ providerId: 'google.com' }],
          metadata: {
            creationTime: '2026-01-01T00:00:00Z',
            lastSignInTime: '2026-01-01T00:00:00Z',
          },
        },
      ],
      pageToken: undefined,
    }));
    const query = vi.fn(async (sql: string) =>
      sql.includes('usuarios')
        ? { rows: [{ uid_match: false, email_match: true }], rowCount: 1 }
        : { rows: [], rowCount: 0 },
    );
    const result = await classifyGoogleIdpAccounts({ listUsers }, { query });
    expect(result[0].classification).toBe('LEGITIMATE');
  });

  it('cuenta no-Google (phone) → excluida del inventario (OQ-G3)', async () => {
    const listUsers = vi.fn(async () => ({
      users: [
        {
          uid: 'uid-phone',
          email: 'p@x.cl',
          displayName: '',
          providerData: [{ providerId: 'phone' }],
          metadata: { creationTime: '2026-01-01T00:00:00Z' },
        },
      ],
      pageToken: undefined,
    }));
    const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    const result = await classifyGoogleIdpAccounts({ listUsers }, { query });
    expect(result).toHaveLength(0);
  });
});
