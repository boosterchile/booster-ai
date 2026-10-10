import { PRICING_METHODOLOGY_VERSION_V3 } from '@booster-ai/pricing-engine';
import { CONFIGURACION_COMERCIAL_INICIAL } from '@booster-ai/shared-schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AssignmentNotDeliveredError,
  AssignmentNotFoundError,
  TierNotFoundError,
  liquidarTrip,
} from '../../src/services/liquidar-trip.js';

const noop = (): void => undefined;
const noopLogger = {
  trace: noop,
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: noop,
  child: () => noopLogger,
} as never;

interface DbQueues {
  selects?: unknown[][];
  inserts?: unknown[][];
  insertImpl?: () => Promise<unknown[]>;
}

function makeDb(opts: DbQueues = {}) {
  const selects = [...(opts.selects ?? [])];
  const inserts = [...(opts.inserts ?? [])];

  const buildSelectChain = () => {
    const chain: Record<string, unknown> = {
      from: vi.fn(() => chain),
      leftJoin: vi.fn(() => chain),
      where: vi.fn(() => chain),
      limit: vi.fn(async () => selects.shift() ?? []),
    };
    return chain;
  };

  const buildInsertChain = (insertImpl?: () => Promise<unknown[]> | unknown[]) => ({
    values: vi.fn(() => ({
      returning: vi.fn(async () => {
        if (insertImpl) {
          return await insertImpl();
        }
        return inserts.shift() ?? [];
      }),
    })),
  });

  const insertValues: unknown[] = [];
  return {
    insertValues,
    select: vi.fn(() => buildSelectChain()),
    insert: vi.fn((_table: unknown) => {
      const chain = buildInsertChain(opts.insertImpl);
      const values = chain.values;
      chain.values = vi.fn((v: unknown) => {
        insertValues.push(v);
        return values(v);
      });
      return chain;
    }),
  };
}

const ASG_ID = '11111111-1111-1111-1111-111111111111';
const EMPRESA_ID = '22222222-2222-2222-2222-222222222222';

const ASG_DELIVERED = {
  id: ASG_ID,
  empresaCarrierId: EMPRESA_ID,
  agreedPriceClp: 1_000_000,
  deliveredAt: new Date('2026-05-10T12:00:00Z'),
};

const TIER_FREE = {
  slug: 'free',
  displayName: 'Booster Free',
  feeMonthlyClp: 0,
  commissionPct: '12.00',
  matchingPriorityBoost: 0,
  trustScoreBoost: 0,
  deviceTeltonikaIncluded: false,
};

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('liquidarTrip — feature flag', () => {
  it('pricingV2Activated=false → skipped_flag_disabled sin tocar DB', async () => {
    const db = makeDb();
    const result = await liquidarTrip({
      db: db as never,
      logger: noopLogger,
      assignmentId: ASG_ID,
      pricingV2Activated: false,
    });
    expect(result).toEqual({ status: 'skipped_flag_disabled' });
    expect(db.select).not.toHaveBeenCalled();
  });
});

describe('liquidarTrip — validación de assignment', () => {
  it('assignment no encontrado → AssignmentNotFoundError', async () => {
    const db = makeDb({ selects: [[]] });
    await expect(
      liquidarTrip({
        db: db as never,
        logger: noopLogger,
        assignmentId: ASG_ID,
        pricingV2Activated: true,
      }),
    ).rejects.toThrow(AssignmentNotFoundError);
  });

  it('assignment sin deliveredAt → AssignmentNotDeliveredError', async () => {
    const db = makeDb({
      selects: [[{ ...ASG_DELIVERED, deliveredAt: null }]],
    });
    await expect(
      liquidarTrip({
        db: db as never,
        logger: noopLogger,
        assignmentId: ASG_ID,
        pricingV2Activated: true,
      }),
    ).rejects.toThrow(AssignmentNotDeliveredError);
  });
});

describe('liquidarTrip — sin membership', () => {
  it('carrier sin membership activa → skipped_no_membership', async () => {
    const db = makeDb({
      selects: [
        [ASG_DELIVERED], // assignment OK
        [], // sin membership
      ],
    });
    const result = await liquidarTrip({
      db: db as never,
      logger: noopLogger,
      assignmentId: ASG_ID,
      pricingV2Activated: true,
    });
    expect(result).toEqual({ status: 'skipped_no_membership' });
  });
});

describe('liquidarTrip — tier no encontrado', () => {
  it('membership.tierSlug no existe en BD → TierNotFoundError', async () => {
    const db = makeDb({
      selects: [
        [ASG_DELIVERED],
        [{ id: 'm1', tierSlug: 'ghost', consentTermsV2AceptadoEn: null }],
        [], // tier lookup vacío
      ],
    });
    await expect(
      liquidarTrip({
        db: db as never,
        logger: noopLogger,
        assignmentId: ASG_ID,
        pricingV2Activated: true,
      }),
    ).rejects.toThrow(TierNotFoundError);
  });
});

describe('liquidarTrip — pending_consent', () => {
  it('membership sin consent → liquidación creada con status pending_consent', async () => {
    const db = makeDb({
      selects: [
        [ASG_DELIVERED],
        [{ id: 'm1', tierSlug: 'free', consentTermsV2AceptadoEn: null }],
        [TIER_FREE],
      ],
      inserts: [[{ id: 'liq-uuid' }]],
    });
    const result = await liquidarTrip({
      db: db as never,
      logger: noopLogger,
      assignmentId: ASG_ID,
      pricingV2Activated: true,
    });
    expect(result).toEqual({ status: 'pending_consent', liquidacionId: 'liq-uuid' });
  });
});

describe('liquidarTrip — happy path', () => {
  it('todo OK → liquidacion_creada con status lista_para_dte', async () => {
    const db = makeDb({
      selects: [
        [ASG_DELIVERED],
        [
          {
            id: 'm1',
            tierSlug: 'free',
            consentTermsV2AceptadoEn: new Date('2026-05-01T00:00:00Z'),
          },
        ],
        [TIER_FREE],
      ],
      inserts: [[{ id: 'liq-new' }]],
    });
    const result = await liquidarTrip({
      db: db as never,
      logger: noopLogger,
      assignmentId: ASG_ID,
      pricingV2Activated: true,
    });
    expect(result).toEqual({ status: 'liquidacion_creada', liquidacionId: 'liq-new' });
    expect(noopLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        montoBruto: 1_000_000,
        comision: 120_000,
        status: 'lista_para_dte',
      }),
      expect.any(String),
    );
  });

  it('captura tier correcto en INSERT (Premium 5%)', async () => {
    const TIER_PREMIUM = { ...TIER_FREE, slug: 'premium', commissionPct: '5.00' };
    const responses: unknown[][] = [
      [ASG_DELIVERED],
      [
        {
          id: 'm1',
          tierSlug: 'premium',
          consentTermsV2AceptadoEn: new Date(),
        },
      ],
      [TIER_PREMIUM],
    ];
    let i = 0;
    const valuesSpy = vi.fn(() => ({
      returning: vi.fn(async () => [{ id: 'liq-prem' }]),
    }));
    const db = {
      select: vi.fn(() => {
        const chain: Record<string, unknown> = {
          from: vi.fn(() => chain),
          where: vi.fn(() => chain),
          limit: vi.fn(async () => responses[i++] ?? []),
        };
        return chain;
      }),
      insert: vi.fn(() => ({ values: valuesSpy })),
    };

    await liquidarTrip({
      db: db as never,
      logger: noopLogger,
      assignmentId: ASG_ID,
      pricingV2Activated: true,
    });

    expect(valuesSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        tierSlugAplicado: 'premium',
        comisionPct: '5.00',
        comisionClp: 50_000,
        montoNetoCarrierClp: 950_000,
        ivaComisionClp: 9_500,
        totalFacturaBoosterClp: 59_500,
      }),
    );
  });
});

describe('liquidarTrip — idempotencia', () => {
  it('UNIQUE violation → ya_liquidada con id existente', async () => {
    let selectCallCount = 0;
    const responses: unknown[][] = [
      [ASG_DELIVERED],
      [
        {
          id: 'm1',
          tierSlug: 'free',
          consentTermsV2AceptadoEn: new Date(),
        },
      ],
      [TIER_FREE],
      // 4ta select: lookup de la liquidación existente.
      [{ id: 'liq-existente' }],
    ];
    const db = {
      select: vi.fn(() => {
        const chain: Record<string, unknown> = {
          from: vi.fn(() => chain),
          where: vi.fn(() => chain),
          limit: vi.fn(async () => responses[selectCallCount++] ?? []),
        };
        return chain;
      }),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn(async () => {
            throw new Error('duplicate key value violates unique constraint');
          }),
        })),
      })),
    };

    const result = await liquidarTrip({
      db: db as never,
      logger: noopLogger,
      assignmentId: ASG_ID,
      pricingV2Activated: true,
    });
    expect(result).toEqual({ status: 'ya_liquidada', liquidacionId: 'liq-existente' });
  });

  it('error NO-UNIQUE durante INSERT → throw', async () => {
    const db = makeDb({
      selects: [
        [ASG_DELIVERED],
        [{ id: 'm1', tierSlug: 'free', consentTermsV2AceptadoEn: new Date() }],
        [TIER_FREE],
      ],
    });
    // Override insert para que lance error genérico (NO unique).
    db.insert = vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(async () => {
          throw new Error('connection lost');
        }),
      })),
    })) as never;
    await expect(
      liquidarTrip({
        db: db as never,
        logger: noopLogger,
        assignmentId: ASG_ID,
        pricingV2Activated: true,
      }),
    ).rejects.toThrow(/connection lost/);
  });
});

describe('liquidarTrip — v3 (ADR-079 §6)', () => {
  const CONFIG_ID = '33333333-3333-3333-3333-333333333333';
  const VIAJE_V3 = {
    comisionPctAplicada: '20.00',
    configuracionComercialId: CONFIG_ID,
    modalidadCarga: 'spot',
    configFila: CONFIGURACION_COMERCIAL_INICIAL,
  };
  const ASG_V3 = { ...ASG_DELIVERED, agreedPriceClp: 700_000, tripId: 'trip-1' };

  it('v3 con tasa congelada → liquida v3 sin consultar membresía', async () => {
    const db = makeDb({ selects: [[ASG_V3], [VIAJE_V3]], inserts: [[{ id: 'liq-v3' }]] });
    const result = await liquidarTrip({
      db: db as never,
      logger: noopLogger,
      assignmentId: ASG_ID,
      pricingV2Activated: false,
      pricingV3Activated: true,
    });
    expect(result).toEqual({ status: 'liquidacion_creada', liquidacionId: 'liq-v3' });
    // Solo assignment + viaje: ni membresía ni tier.
    expect(db.select).toHaveBeenCalledTimes(2);
    expect(db.insertValues[0]).toMatchObject({
      tierSlugAplicado: null,
      montoBrutoClp: 700_000,
      montoNetoCarrierClp: 700_000,
      comisionPct: '20.00',
      comisionClp: 140_000,
      ivaComisionClp: 26_600,
      precioGeneradorClp: 840_000,
      // ADR-079 §1: Booster factura al generador comisión + IVA.
      totalFacturaGeneradorClp: 166_600,
      totalFacturaBoosterClp: 166_600,
      modalidadCarga: 'spot',
      configuracionComercialId: CONFIG_ID,
      pricingMethodologyVersion: PRICING_METHODOLOGY_VERSION_V3,
      status: 'lista_para_dte',
    });
  });

  it('ADR-080 Verificación 1: sin MANDATO_COBRO_ACTIVATED la liquidación v3 queda conector', async () => {
    const db = makeDb({ selects: [[ASG_V3], [VIAJE_V3]], inserts: [[{ id: 'liq-v3' }]] });
    await liquidarTrip({
      db: db as never,
      logger: noopLogger,
      assignmentId: ASG_ID,
      pricingV2Activated: false,
      pricingV3Activated: true,
    });
    expect(db.insertValues[0]).toMatchObject({ modoFlujo: 'conector' });
  });

  it('ADR-080 §5: con MANDATO_COBRO_ACTIVATED la liquidación v3 queda mandato_cobro', async () => {
    const db = makeDb({ selects: [[ASG_V3], [VIAJE_V3]], inserts: [[{ id: 'liq-v3' }]] });
    await liquidarTrip({
      db: db as never,
      logger: noopLogger,
      assignmentId: ASG_ID,
      pricingV2Activated: false,
      pricingV3Activated: true,
      mandatoCobroActivated: true,
    });
    expect(db.insertValues[0]).toMatchObject({ modoFlujo: 'mandato_cobro' });
  });

  it('v3 sin tasa congelada y v2 apagado → skipped_flag_disabled sin insertar', async () => {
    const db = makeDb({
      selects: [[ASG_V3], [{ ...VIAJE_V3, comisionPctAplicada: null, configFila: null }]],
    });
    const result = await liquidarTrip({
      db: db as never,
      logger: noopLogger,
      assignmentId: ASG_ID,
      pricingV2Activated: false,
      pricingV3Activated: true,
    });
    expect(result).toEqual({ status: 'skipped_flag_disabled' });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('v3 sin tasa congelada y v2 activo → sigue el camino v2 (consulta membresía)', async () => {
    const db = makeDb({ selects: [[ASG_V3], []] });
    await liquidarTrip({
      db: db as never,
      logger: noopLogger,
      assignmentId: ASG_ID,
      pricingV2Activated: true,
      pricingV3Activated: true,
    }).catch(() => undefined);
    // assignment + viaje (sin fila) + membresía del camino v2.
    expect(db.select.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('UNIQUE envuelta por Drizzle (cause.code 23505) → ya_liquidada', async () => {
    const dupe = Object.assign(new Error('Failed query: insert into "liquidaciones"'), {
      cause: { code: '23505' },
    });
    const db = makeDb({
      selects: [[ASG_V3], [VIAJE_V3], [{ id: 'liq-previa' }]],
      insertImpl: async () => {
        throw dupe;
      },
    });
    const result = await liquidarTrip({
      db: db as never,
      logger: noopLogger,
      assignmentId: ASG_ID,
      pricingV2Activated: false,
      pricingV3Activated: true,
    });
    expect(result).toEqual({ status: 'ya_liquidada', liquidacionId: 'liq-previa' });
  });

  it('error no-UNIQUE en el INSERT v3 se propaga', async () => {
    const db = makeDb({
      selects: [[ASG_V3], [VIAJE_V3]],
      insertImpl: async () => {
        throw new Error('connection reset');
      },
    });
    await expect(
      liquidarTrip({
        db: db as never,
        logger: noopLogger,
        assignmentId: ASG_ID,
        pricingV2Activated: false,
        pricingV3Activated: true,
      }),
    ).rejects.toThrow('connection reset');
  });

  it('INSERT v3 sin id devuelto → error de estado inconsistente', async () => {
    const db = makeDb({ selects: [[ASG_V3], [VIAJE_V3]], inserts: [[]] });
    await expect(
      liquidarTrip({
        db: db as never,
        logger: noopLogger,
        assignmentId: ASG_ID,
        pricingV2Activated: false,
        pricingV3Activated: true,
      }),
    ).rejects.toThrow(/estado inconsistente/);
  });
});
