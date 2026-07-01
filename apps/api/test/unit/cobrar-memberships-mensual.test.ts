import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cobrarMembershipsMensual } from '../../src/services/cobrar-memberships-mensual.js';
import type {
  CobroGatewayResultado,
  MembershipPaymentGateway,
} from '../../src/services/membership-payment-gateway.js';

/**
 * Tests del cron de cobro mensual de membresías (gap B5, ADR-030 §7 + ADR-031).
 *
 * El service:
 *   1. Si `pricingV2Activated=false` → no-op total, sin tocar BD.
 *   2. SELECT memberships activas en tier pagado (fee>0).
 *   3. Para cada una, SELECT su factura del periodo (idempotencia).
 *      - sin factura → calcular (pura) + INSERT + cobrar (gateway) + UPDATE dunning.
 *      - factura reintentable (pending_payment_provider/reintentando con
 *        proximo_intento vencido) → cobrar de nuevo + UPDATE dunning.
 *      - factura ya cobrada/morosa/al-día → skip.
 *   4. El gateway default (stub) NO cobra → deja pending_payment_provider.
 *
 * El rail de pago es un STUB inyectado. NO mueve dinero.
 */

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

const EMPRESA_A = '11111111-1111-1111-1111-111111111111';
const EMPRESA_B = '22222222-2222-2222-2222-222222222222';
const HOY_MS = Date.UTC(2026, 5, 15, 12, 0, 0); // 2026-06-15T12:00Z → periodo 2026-06

const TIER_STANDARD = {
  slug: 'standard',
  displayName: 'Booster Standard',
  feeMonthlyClp: 15_000,
  commissionPct: '9.00',
  matchingPriorityBoost: 5,
  trustScoreBoost: 0,
  deviceTeltonikaIncluded: false,
};

/**
 * DB mock con colas de respuestas para selects/inserts y captura de updates.
 * Modela el chain de drizzle (select().from().where().limit() y
 * insert().values().returning(), update().set().where()).
 */
function makeDb(opts: {
  selects?: unknown[][];
  inserts?: Array<unknown[] | (() => Promise<unknown[]>)>;
}) {
  const selects = [...(opts.selects ?? [])];
  const inserts = [...(opts.inserts ?? [])];
  const updateCalls: Array<Record<string, unknown>> = [];
  const insertValues: Array<Record<string, unknown>> = [];

  const buildSelectChain = () => {
    const chain: Record<string, unknown> = {
      from: vi.fn(() => chain),
      innerJoin: vi.fn(() => chain),
      where: vi.fn(() => chain),
      limit: vi.fn(async () => selects.shift() ?? []),
    };
    return chain;
  };

  const db = {
    select: vi.fn(() => buildSelectChain()),
    insert: vi.fn(() => ({
      values: vi.fn((v: Record<string, unknown>) => {
        insertValues.push(v);
        return {
          returning: vi.fn(async () => {
            const next = inserts.shift();
            if (typeof next === 'function') {
              return await next();
            }
            return next ?? [];
          }),
        };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((v: Record<string, unknown>) => {
        updateCalls.push(v);
        return { where: vi.fn(async () => []) };
      }),
    })),
  };

  return { db, updateCalls, insertValues };
}

/** Gateway que captura las llamadas y devuelve lo que se le configure. */
function makeGateway(resultado: CobroGatewayResultado): {
  gateway: MembershipPaymentGateway;
  cobrar: ReturnType<typeof vi.fn>;
} {
  const cobrar = vi.fn(async () => resultado);
  return { gateway: { cobrar }, cobrar };
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('cobrarMembershipsMensual — feature flag', () => {
  it('pricingV2Activated=false → skipped_flag_disabled sin tocar BD', async () => {
    const { db } = makeDb({});
    const { gateway, cobrar } = makeGateway({ resultado: 'pending_provider', gatewayRef: null });
    const result = await cobrarMembershipsMensual({
      db: db as never,
      logger: noopLogger,
      gateway,
      pricingV2Activated: false,
      hoyMs: HOY_MS,
    });
    expect(result.status).toBe('skipped_flag_disabled');
    expect(db.select).not.toHaveBeenCalled();
    expect(cobrar).not.toHaveBeenCalled();
  });
});

describe('cobrarMembershipsMensual — sin memberships pagadas', () => {
  it('cero memberships en tier pagado → 200 con counts en cero', async () => {
    const { db } = makeDb({ selects: [[]] });
    const { gateway } = makeGateway({ resultado: 'pending_provider', gatewayRef: null });
    const result = await cobrarMembershipsMensual({
      db: db as never,
      logger: noopLogger,
      gateway,
      pricingV2Activated: true,
      hoyMs: HOY_MS,
    });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }
    expect(result.periodoMes).toBe('2026-06');
    expect(result.facturasCreadas).toBe(0);
    expect(result.reintentos).toBe(0);
    expect(result.morosas).toBe(0);
  });
});

describe('cobrarMembershipsMensual — factura nueva + stub no-op', () => {
  it('membership Standard sin factura del periodo → crea factura y stub la deja pending_payment_provider', async () => {
    const { db, updateCalls, insertValues } = makeDb({
      selects: [
        // (1) memberships pagadas activas (innerJoin tiers)
        [{ empresaId: EMPRESA_A, tierSlug: 'standard' }],
        // (2) factura existente del periodo → ninguna
        [],
        // (3) tier lookup (cargarTier) para los montos
        [TIER_STANDARD],
      ],
      // INSERT factura → devuelve id
      inserts: [[{ id: 'fac-A' }]],
    });
    const { gateway, cobrar } = makeGateway({ resultado: 'pending_provider', gatewayRef: null });

    const result = await cobrarMembershipsMensual({
      db: db as never,
      logger: noopLogger,
      gateway,
      pricingV2Activated: true,
      hoyMs: HOY_MS,
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }
    expect(result.facturasCreadas).toBe(1);
    expect(result.pendingProvider).toBe(1);
    expect(result.morosas).toBe(0);

    // La factura se insertó con los montos de la función pura (15k + IVA).
    expect(insertValues[0]).toEqual(
      expect.objectContaining({
        empresaDestinoId: EMPRESA_A,
        tipo: 'membership_mensual',
        periodoMes: '2026-06',
        subtotalClp: 15_000,
        ivaClp: 2_850,
        totalClp: 17_850,
        status: 'pendiente',
        cobroEstado: 'pendiente_cobro',
      }),
    );

    // El gateway se invocó con el id y el total.
    expect(cobrar).toHaveBeenCalledWith(
      expect.objectContaining({ facturaId: 'fac-A', empresaId: EMPRESA_A, totalClp: 17_850 }),
    );

    // Tras el stub no-op, la factura queda en pending_payment_provider con 1 intento.
    expect(updateCalls[0]).toEqual(
      expect.objectContaining({
        cobroEstado: 'pending_payment_provider',
        cobroIntentos: 1,
      }),
    );
  });
});

describe('cobrarMembershipsMensual — idempotencia (no cobra dos veces el mismo ciclo)', () => {
  it('factura del periodo ya cobrada → no reintenta, no inserta', async () => {
    const { db, updateCalls } = makeDb({
      selects: [
        [{ empresaId: EMPRESA_A, tierSlug: 'standard' }],
        // factura del periodo ya existe y está cobrada
        [
          {
            id: 'fac-A',
            cobroEstado: 'cobrada',
            cobroIntentos: 1,
            cobroProximoIntentoEn: null,
          },
        ],
      ],
    });
    const { gateway, cobrar } = makeGateway({ resultado: 'pending_provider', gatewayRef: null });

    const result = await cobrarMembershipsMensual({
      db: db as never,
      logger: noopLogger,
      gateway,
      pricingV2Activated: true,
      hoyMs: HOY_MS,
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }
    expect(result.facturasCreadas).toBe(0);
    expect(result.reintentos).toBe(0);
    expect(cobrar).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
  });

  it('INSERT viola el unique parcial (race) → cuenta ya_facturada sin romper', async () => {
    const { db } = makeDb({
      selects: [
        [{ empresaId: EMPRESA_A, tierSlug: 'standard' }],
        [], // no veo factura del periodo
        [TIER_STANDARD], // cargarTier
      ],
      inserts: [
        () => {
          throw new Error('duplicate key value violates unique constraint');
        },
      ],
    });
    const { gateway, cobrar } = makeGateway({ resultado: 'pending_provider', gatewayRef: null });

    const result = await cobrarMembershipsMensual({
      db: db as never,
      logger: noopLogger,
      gateway,
      pricingV2Activated: true,
      hoyMs: HOY_MS,
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }
    expect(result.facturasCreadas).toBe(0);
    expect(result.yaFacturadas).toBe(1);
    // No se cobra una factura que no se pudo crear (otro proceso la maneja).
    expect(cobrar).not.toHaveBeenCalled();
  });
});

describe('cobrarMembershipsMensual — dunning (reintentos)', () => {
  it('factura pending_payment_provider con proximo_intento vencido → reintenta, incrementa contador', async () => {
    const { db, updateCalls } = makeDb({
      selects: [
        [{ empresaId: EMPRESA_A, tierSlug: 'standard' }],
        // factura del periodo: 1 intento previo, reintento ya vencido
        [
          {
            id: 'fac-A',
            totalClp: 17_850,
            cobroEstado: 'pending_payment_provider',
            cobroIntentos: 1,
            cobroProximoIntentoEn: new Date(HOY_MS - 60_000), // venció hace 1 min
          },
        ],
      ],
    });
    const { gateway, cobrar } = makeGateway({ resultado: 'pending_provider', gatewayRef: null });

    const result = await cobrarMembershipsMensual({
      db: db as never,
      logger: noopLogger,
      gateway,
      pricingV2Activated: true,
      hoyMs: HOY_MS,
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }
    expect(result.reintentos).toBe(1);
    expect(result.facturasCreadas).toBe(0);
    // El total fluye desde la factura existente (sin re-query).
    expect(cobrar).toHaveBeenCalledWith(
      expect.objectContaining({ facturaId: 'fac-A', intento: 2, totalClp: 17_850 }),
    );
    // 2º intento pending → reintentando, contador 2.
    expect(updateCalls[0]).toEqual(
      expect.objectContaining({ cobroEstado: 'reintentando', cobroIntentos: 2 }),
    );
  });

  it('3er intento pending → factura morosa (status contable vencida)', async () => {
    const { db, updateCalls } = makeDb({
      selects: [
        [{ empresaId: EMPRESA_A, tierSlug: 'standard' }],
        [
          {
            id: 'fac-A',
            totalClp: 17_850,
            cobroEstado: 'reintentando',
            cobroIntentos: 2, // ya van 2; éste es el 3º
            cobroProximoIntentoEn: new Date(HOY_MS - 60_000),
          },
        ],
      ],
    });
    const { gateway } = makeGateway({ resultado: 'pending_provider', gatewayRef: null });

    const result = await cobrarMembershipsMensual({
      db: db as never,
      logger: noopLogger,
      gateway,
      pricingV2Activated: true,
      hoyMs: HOY_MS,
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }
    expect(result.reintentos).toBe(1);
    expect(result.morosas).toBe(1);
    expect(updateCalls[0]).toEqual(
      expect.objectContaining({
        cobroEstado: 'morosa',
        cobroIntentos: 3,
        status: 'vencida', // refleja la morosidad en el status contable
        cobroProximoIntentoEn: null,
      }),
    );
  });

  it('factura reintentable pero proximo_intento aún en el futuro → no reintenta', async () => {
    const { db, updateCalls } = makeDb({
      selects: [
        [{ empresaId: EMPRESA_A, tierSlug: 'standard' }],
        [
          {
            id: 'fac-A',
            cobroEstado: 'pending_payment_provider',
            cobroIntentos: 1,
            cobroProximoIntentoEn: new Date(HOY_MS + 3 * 24 * 60 * 60 * 1000), // en 3 días
          },
        ],
      ],
    });
    const { gateway, cobrar } = makeGateway({ resultado: 'pending_provider', gatewayRef: null });

    const result = await cobrarMembershipsMensual({
      db: db as never,
      logger: noopLogger,
      gateway,
      pricingV2Activated: true,
      hoyMs: HOY_MS,
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }
    expect(result.reintentos).toBe(0);
    expect(cobrar).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
  });
});

describe('cobrarMembershipsMensual — pago exitoso (provider real futuro)', () => {
  it('gateway devuelve pagada → factura cobrada + pagada, gatewayRef persistido', async () => {
    const { db, updateCalls } = makeDb({
      selects: [
        [{ empresaId: EMPRESA_A, tierSlug: 'standard' }],
        [], // sin factura del periodo
        [TIER_STANDARD], // cargarTier
      ],
      inserts: [[{ id: 'fac-A' }]],
    });
    const { gateway } = makeGateway({ resultado: 'pagada', gatewayRef: 'txn-xyz' });

    const result = await cobrarMembershipsMensual({
      db: db as never,
      logger: noopLogger,
      gateway,
      pricingV2Activated: true,
      hoyMs: HOY_MS,
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }
    expect(result.cobradas).toBe(1);
    expect(result.pendingProvider).toBe(0);
    expect(updateCalls[0]).toEqual(
      expect.objectContaining({
        cobroEstado: 'cobrada',
        cobroIntentos: 1,
        status: 'pagada',
        cobroGatewayRef: 'txn-xyz',
      }),
    );
  });
});

describe('cobrarMembershipsMensual — múltiples memberships', () => {
  it('procesa varias memberships en un tick (counts agregados)', async () => {
    const { db } = makeDb({
      selects: [
        // memberships pagadas
        [
          { empresaId: EMPRESA_A, tierSlug: 'standard' },
          { empresaId: EMPRESA_B, tierSlug: 'standard' },
        ],
        // empresa A: sin factura del periodo + tier
        [],
        [TIER_STANDARD],
        // empresa B: sin factura del periodo + tier
        [],
        [TIER_STANDARD],
      ],
      inserts: [[{ id: 'fac-A' }], [{ id: 'fac-B' }]],
    });
    const { gateway, cobrar } = makeGateway({ resultado: 'pending_provider', gatewayRef: null });

    const result = await cobrarMembershipsMensual({
      db: db as never,
      logger: noopLogger,
      gateway,
      pricingV2Activated: true,
      hoyMs: HOY_MS,
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') {
      return;
    }
    expect(result.facturasCreadas).toBe(2);
    expect(result.pendingProvider).toBe(2);
    expect(cobrar).toHaveBeenCalledTimes(2);
  });
});
