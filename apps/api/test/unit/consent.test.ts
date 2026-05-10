import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkStakeholderConsent,
  grantConsent,
  listConsentsGrantedBy,
  recordStakeholderAccess,
  revokeConsent,
} from '../../src/services/consent.js';

const noop = (): void => undefined;
const noopLogger = {
  trace: noop,
  debug: noop,
  info: vi.fn(),
  warn: vi.fn(),
  error: noop,
  fatal: noop,
  child: () => noopLogger,
} as never;

interface DbStub {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
}

/**
 * Builder de DB stub que matchea el patrón fluent de Drizzle:
 *   db.select(...).from(t).where(c).limit(n)
 *   db.insert(t).values(v).returning(cols)
 *   db.update(t).set(v).where(c).returning(cols)
 */
function makeDb(opts: {
  selectResults?: unknown[][]; // queue de resultados de select chains
  insertResults?: unknown[][]; // queue de resultados de insert returning
  updateResults?: unknown[][]; // queue de resultados de update returning
}): DbStub {
  const selectQueue = [...(opts.selectResults ?? [])];
  const insertQueue = [...(opts.insertResults ?? [])];
  const updateQueue = [...(opts.updateResults ?? [])];

  const buildSelectChain = () => {
    const chain: Record<string, unknown> = {
      from: vi.fn(() => chain),
      innerJoin: vi.fn(() => chain),
      where: vi.fn(() => chain),
      orderBy: vi.fn(() => chain),
      limit: vi.fn(async () => selectQueue.shift() ?? []),
      then: undefined as unknown,
    };
    // Hacer la cadena thenable para `await db.select()...`.
    chain.then = (resolve: (v: unknown) => unknown) => {
      const result = selectQueue.shift() ?? [];
      return Promise.resolve(resolve(result));
    };
    return chain;
  };

  const buildInsertChain = () => {
    const chain: Record<string, unknown> = {
      values: vi.fn(() => chain),
      returning: vi.fn(async () => insertQueue.shift() ?? []),
    };
    return chain;
  };

  const buildUpdateChain = () => {
    const chain: Record<string, unknown> = {
      set: vi.fn(() => chain),
      where: vi.fn(() => chain),
      returning: vi.fn(async () => updateQueue.shift() ?? []),
    };
    return chain;
  };

  return {
    select: vi.fn(() => buildSelectChain()),
    insert: vi.fn(() => buildInsertChain()),
    update: vi.fn(() => buildUpdateChain()),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('checkStakeholderConsent', () => {
  const baseOpts = {
    stakeholderId: 'stk-1',
    scopeType: 'generador_carga' as const,
    scopeId: 'emp-1',
    dataCategory: 'emisiones_carbono' as const,
  };

  it('sin consent activo → allowed=false, reason="no_active_consent"', async () => {
    const db = makeDb({ selectResults: [[]] });
    const result = await checkStakeholderConsent({
      ...baseOpts,
      db: db as never,
      logger: noopLogger,
    });
    expect(result).toEqual({ allowed: false, reason: 'no_active_consent' });
  });

  it('consent activo + categoría incluida → allowed=true', async () => {
    const db = makeDb({
      selectResults: [
        [
          {
            id: 'consent-1',
            dataCategories: ['emisiones_carbono', 'rutas'],
            revokedAt: null,
            expiresAt: null,
          },
        ],
      ],
    });
    const result = await checkStakeholderConsent({
      ...baseOpts,
      db: db as never,
      logger: noopLogger,
    });
    expect(result).toEqual({ allowed: true, consentId: 'consent-1' });
  });

  it('consent existe pero categoría no incluida → allowed=false, reason="data_category_not_granted"', async () => {
    const db = makeDb({
      selectResults: [
        [
          {
            id: 'consent-1',
            dataCategories: ['rutas', 'distancias'], // no incluye emisiones_carbono
            revokedAt: null,
            expiresAt: null,
          },
        ],
      ],
    });
    const result = await checkStakeholderConsent({
      ...baseOpts,
      db: db as never,
      logger: noopLogger,
    });
    expect(result).toEqual({ allowed: false, reason: 'data_category_not_granted' });
  });

  it('consent revocado (defensa redundante post-query) → allowed=false', async () => {
    const db = makeDb({
      selectResults: [
        [
          {
            id: 'consent-1',
            dataCategories: ['emisiones_carbono'],
            revokedAt: new Date('2026-04-01'),
            expiresAt: null,
          },
        ],
      ],
    });
    const result = await checkStakeholderConsent({
      ...baseOpts,
      db: db as never,
      logger: noopLogger,
    });
    expect(result).toEqual({ allowed: false, reason: 'consent_revoked' });
  });

  it('consent expirado (defensa redundante post-query) → allowed=false', async () => {
    const db = makeDb({
      selectResults: [
        [
          {
            id: 'consent-1',
            dataCategories: ['emisiones_carbono'],
            revokedAt: null,
            expiresAt: new Date('2020-01-01'),
          },
        ],
      ],
    });
    const result = await checkStakeholderConsent({
      ...baseOpts,
      db: db as never,
      logger: noopLogger,
    });
    expect(result).toEqual({ allowed: false, reason: 'consent_expired' });
  });
});

describe('recordStakeholderAccess', () => {
  it('inserta una row en stakeholder_access_log', async () => {
    const db = makeDb({ insertResults: [[]] });
    await recordStakeholderAccess({
      db: db as never,
      logger: noopLogger,
      stakeholderId: 'stk-1',
      consentId: 'consent-1',
      scopeType: 'generador_carga',
      scopeId: 'emp-1',
      dataCategory: 'emisiones_carbono',
      httpPath: '/me/stakeholder/portfolio/123/emissions',
      actorFirebaseUid: 'fb-uid',
      bytesServed: 4096,
    });
    expect(db.insert).toHaveBeenCalledTimes(1);
  });
});

describe('grantConsent', () => {
  const baseOpts = {
    grantedByUserId: 'user-grantor',
    stakeholderId: 'stk-1',
    scopeType: 'organizacion' as const,
    scopeId: 'emp-1',
    dataCategories: ['emisiones_carbono', 'certificados'] as const,
    consentDocumentUrl: 'https://docs.boosterchile.com/consents/abc.pdf',
  };

  it('happy path: inserta consent y retorna su id', async () => {
    const db = makeDb({ insertResults: [[{ id: 'new-consent-uuid' }]] });
    const result = await grantConsent({
      ...baseOpts,
      dataCategories: [...baseOpts.dataCategories],
      db: db as never,
      logger: noopLogger,
    });
    expect(result).toEqual({ consentId: 'new-consent-uuid' });
    expect(noopLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ consentId: 'new-consent-uuid' }),
      'consent otorgado',
    );
  });

  it('rechaza dataCategories vacío', async () => {
    const db = makeDb({});
    await expect(
      grantConsent({
        ...baseOpts,
        dataCategories: [],
        db: db as never,
        logger: noopLogger,
      }),
    ).rejects.toThrow(/dataCategory/);
  });

  it('rechaza consentDocumentUrl no-HTTPS', async () => {
    const db = makeDb({});
    await expect(
      grantConsent({
        ...baseOpts,
        dataCategories: [...baseOpts.dataCategories],
        consentDocumentUrl: 'http://insecure.example.com/consent.pdf',
        db: db as never,
        logger: noopLogger,
      }),
    ).rejects.toThrow(/HTTPS/);
  });

  it('expiresAt nullable se persiste como null', async () => {
    const db = makeDb({ insertResults: [[{ id: 'c1' }]] });
    await grantConsent({
      ...baseOpts,
      dataCategories: [...baseOpts.dataCategories],
      expiresAt: null,
      db: db as never,
      logger: noopLogger,
    });
    expect(db.insert).toHaveBeenCalledTimes(1);
  });
});

describe('revokeConsent', () => {
  const baseOpts = {
    consentId: 'c1',
    revokedByUserId: 'user-grantor',
  };

  it('happy path: UPDATE retorna 1 row → revoked=true, alreadyRevoked=false', async () => {
    const db = makeDb({ updateResults: [[{ id: 'c1' }]] });
    const result = await revokeConsent({
      ...baseOpts,
      db: db as never,
      logger: noopLogger,
    });
    expect(result).toEqual({ revoked: true, alreadyRevoked: false });
  });

  it('UPDATE 0 rows + consent existe revocado → alreadyRevoked=true', async () => {
    const db = makeDb({
      updateResults: [[]],
      selectResults: [[{ grantedByUserId: 'user-grantor', revokedAt: new Date('2026-04-01') }]],
    });
    const result = await revokeConsent({
      ...baseOpts,
      db: db as never,
      logger: noopLogger,
    });
    expect(result).toEqual({ revoked: false, alreadyRevoked: true });
  });

  it('UPDATE 0 rows + consent no existe → revoked=false, alreadyRevoked=false', async () => {
    const db = makeDb({
      updateResults: [[]],
      selectResults: [[]],
    });
    const result = await revokeConsent({
      ...baseOpts,
      db: db as never,
      logger: noopLogger,
    });
    expect(result).toEqual({ revoked: false, alreadyRevoked: false });
  });

  it('UPDATE 0 rows + consent existe pero de otro otorgante → defensa redundante log', async () => {
    const db = makeDb({
      updateResults: [[]],
      selectResults: [[{ grantedByUserId: 'OTRO-user', revokedAt: null }]],
    });
    const result = await revokeConsent({
      ...baseOpts,
      db: db as never,
      logger: noopLogger,
    });
    expect(result).toEqual({ revoked: false, alreadyRevoked: false });
    expect(noopLogger.warn).toHaveBeenCalled();
  });
});

describe('listConsentsGrantedBy', () => {
  it('default: solo retorna consents activos (no revocados ni expirados)', async () => {
    const db = makeDb({
      selectResults: [
        [
          {
            id: 'c1',
            stakeholderId: 'stk-1',
            stakeholderOrgName: 'Walmart Chile S.A.',
            scopeType: 'organizacion',
            scopeId: 'emp-1',
            dataCategories: ['emisiones_carbono'],
            grantedAt: new Date('2026-01-01'),
            expiresAt: null,
            revokedAt: null,
          },
        ],
      ],
    });
    const result = await listConsentsGrantedBy({
      db: db as never,
      grantedByUserId: 'user-grantor',
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.stakeholderOrgName).toBe('Walmart Chile S.A.');
  });

  it('includeInactive: incluye revocados y expirados', async () => {
    const db = makeDb({
      selectResults: [
        [
          {
            id: 'c1',
            stakeholderId: 'stk-1',
            stakeholderOrgName: 'Org',
            scopeType: 'organizacion',
            scopeId: 'emp-1',
            dataCategories: ['emisiones_carbono'],
            grantedAt: new Date('2026-01-01'),
            expiresAt: null,
            revokedAt: new Date('2026-04-01'),
          },
        ],
      ],
    });
    const result = await listConsentsGrantedBy({
      db: db as never,
      grantedByUserId: 'user-grantor',
      includeInactive: true,
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.revokedAt).toBeInstanceOf(Date);
  });
});
