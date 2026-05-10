import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cobraHoy, cotizarCobraHoy } from '../../src/services/cobra-hoy.js';

const noop = (): void => undefined;
const noopLogger = {
  trace: noop,
  debug: noop,
  info: vi.fn(),
  warn: noop,
  error: noop,
  fatal: noop,
  child: () => noopLogger,
} as never;

interface DbQueues {
  selects?: unknown[][];
  inserts?: unknown[][];
}

function makeDb(opts: DbQueues = {}) {
  const selects = [...(opts.selects ?? [])];
  const inserts = [...(opts.inserts ?? [])];

  return {
    select: vi.fn(() => {
      const chain: Record<string, unknown> = {
        from: vi.fn(() => chain),
        where: vi.fn(() => chain),
        limit: vi.fn(async () => selects.shift() ?? []),
      };
      return chain;
    }),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(async () => inserts.shift() ?? []),
      })),
    })),
  };
}

const ASG_ID = '11111111-1111-1111-1111-111111111111';
const CARRIER_ID = '22222222-2222-2222-2222-222222222222';
const SHIPPER_ID = '33333333-3333-3333-3333-333333333333';
const TRIP_ID = '44444444-4444-4444-4444-444444444444';
const LIQ_ID = '55555555-5555-5555-5555-555555555555';

const ASG_DELIVERED = {
  id: ASG_ID,
  tripId: TRIP_ID,
  empresaCarrierId: CARRIER_ID,
  deliveredAt: new Date('2026-05-10T12:00:00Z'),
};
const TRIP = { generadorCargaEmpresaId: SHIPPER_ID };
const LIQ = { id: LIQ_ID, montoNetoCarrierClp: 1_000_000 };
const DECISION_OK = {
  approved: true,
  limitExposureClp: 10_000_000,
  currentExposureClp: 0,
  motivo: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('cobraHoy — feature flag', () => {
  it('factoringV1Activated=false → skipped_flag_disabled', async () => {
    const db = makeDb();
    const r = await cobraHoy({
      db: db as never,
      logger: noopLogger,
      asignacionId: ASG_ID,
      empresaCarrierId: CARRIER_ID,
      factoringV1Activated: false,
    });
    expect(r).toEqual({ status: 'skipped_flag_disabled' });
    expect(db.select).not.toHaveBeenCalled();
  });
});

describe('cobraHoy — validación de assignment', () => {
  it('assignment no existe → assignment_not_found', async () => {
    const db = makeDb({ selects: [[]] });
    const r = await cobraHoy({
      db: db as never,
      logger: noopLogger,
      asignacionId: ASG_ID,
      empresaCarrierId: CARRIER_ID,
      factoringV1Activated: true,
    });
    expect(r.status).toBe('assignment_not_found');
  });

  it('otra empresa pidiendo cobra-hoy → forbidden_owner_mismatch', async () => {
    const db = makeDb({ selects: [[ASG_DELIVERED]] });
    const r = await cobraHoy({
      db: db as never,
      logger: noopLogger,
      asignacionId: ASG_ID,
      empresaCarrierId: 'otra-empresa',
      factoringV1Activated: true,
    });
    expect(r.status).toBe('forbidden_owner_mismatch');
  });

  it('assignment sin deliveredAt → assignment_not_delivered', async () => {
    const db = makeDb({
      selects: [[{ ...ASG_DELIVERED, deliveredAt: null }]],
    });
    const r = await cobraHoy({
      db: db as never,
      logger: noopLogger,
      asignacionId: ASG_ID,
      empresaCarrierId: CARRIER_ID,
      factoringV1Activated: true,
    });
    expect(r.status).toBe('assignment_not_delivered');
  });
});

describe('cobraHoy — liquidación + shipper credit', () => {
  it('sin liquidación → no_liquidacion', async () => {
    const db = makeDb({
      selects: [[ASG_DELIVERED], [TRIP], []],
    });
    const r = await cobraHoy({
      db: db as never,
      logger: noopLogger,
      asignacionId: ASG_ID,
      empresaCarrierId: CARRIER_ID,
      factoringV1Activated: true,
    });
    expect(r.status).toBe('no_liquidacion');
  });

  it('shipper sin decisión vigente → shipper_no_aprobado', async () => {
    const db = makeDb({
      selects: [[ASG_DELIVERED], [TRIP], [LIQ], []],
    });
    const r = await cobraHoy({
      db: db as never,
      logger: noopLogger,
      asignacionId: ASG_ID,
      empresaCarrierId: CARRIER_ID,
      factoringV1Activated: true,
    });
    expect(r.status).toBe('shipper_no_aprobado');
  });

  it('shipper decisión approved=false → shipper_no_aprobado con motivo', async () => {
    const db = makeDb({
      selects: [
        [ASG_DELIVERED],
        [TRIP],
        [LIQ],
        [{ ...DECISION_OK, approved: false, motivo: 'Score 400 < 550' }],
      ],
    });
    const r = await cobraHoy({
      db: db as never,
      logger: noopLogger,
      asignacionId: ASG_ID,
      empresaCarrierId: CARRIER_ID,
      factoringV1Activated: true,
    });
    expect(r.status).toBe('shipper_no_aprobado');
    if (r.status === 'shipper_no_aprobado') {
      expect(r.motivo).toContain('Score 400');
    }
  });

  it('límite de exposición excedido → limite_exposicion_excedido', async () => {
    const db = makeDb({
      selects: [
        [ASG_DELIVERED],
        [TRIP],
        [LIQ],
        [{ ...DECISION_OK, currentExposureClp: 9_500_000 }],
      ],
    });
    const r = await cobraHoy({
      db: db as never,
      logger: noopLogger,
      asignacionId: ASG_ID,
      empresaCarrierId: CARRIER_ID,
      factoringV1Activated: true,
    });
    // 9.5M + ~985k = 10.485M > 10M límite
    expect(r.status).toBe('limite_exposicion_excedido');
  });
});

describe('cobraHoy — happy path', () => {
  it('todo OK → solicitado con tarifa 1.5% (30d default)', async () => {
    const db = makeDb({
      selects: [[ASG_DELIVERED], [TRIP], [LIQ], [DECISION_OK]],
      inserts: [[{ id: 'adelanto-uuid' }]],
    });
    const r = await cobraHoy({
      db: db as never,
      logger: noopLogger,
      asignacionId: ASG_ID,
      empresaCarrierId: CARRIER_ID,
      factoringV1Activated: true,
    });
    expect(r.status).toBe('solicitado');
    if (r.status === 'solicitado') {
      expect(r.tarifaPct).toBe(1.5);
      expect(r.tarifaClp).toBe(15_000);
      expect(r.montoAdelantadoClp).toBe(985_000);
      expect(r.adelantoId).toBe('adelanto-uuid');
    }
  });
});

describe('cobraHoy — idempotencia', () => {
  it('UNIQUE violation → ya_solicitado con id existente', async () => {
    let i = 0;
    const responses: unknown[][] = [
      [ASG_DELIVERED],
      [TRIP],
      [LIQ],
      [DECISION_OK],
      [{ id: 'adelanto-existente' }],
    ];
    const db = {
      select: vi.fn(() => {
        const chain: Record<string, unknown> = {
          from: vi.fn(() => chain),
          where: vi.fn(() => chain),
          limit: vi.fn(async () => responses[i++] ?? []),
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
    const r = await cobraHoy({
      db: db as never,
      logger: noopLogger,
      asignacionId: ASG_ID,
      empresaCarrierId: CARRIER_ID,
      factoringV1Activated: true,
    });
    expect(r).toEqual({ status: 'ya_solicitado', adelantoId: 'adelanto-existente' });
  });
});

describe('cotizarCobraHoy', () => {
  it('assignment no existe → assignment_not_found', async () => {
    const db = makeDb({ selects: [[]] });
    const r = await cotizarCobraHoy({
      db: db as never,
      asignacionId: ASG_ID,
      empresaCarrierId: CARRIER_ID,
    });
    expect(r.status).toBe('assignment_not_found');
  });

  it('otra empresa → forbidden_owner_mismatch', async () => {
    const db = makeDb({ selects: [[ASG_DELIVERED]] });
    const r = await cotizarCobraHoy({
      db: db as never,
      asignacionId: ASG_ID,
      empresaCarrierId: 'otra',
    });
    expect(r.status).toBe('forbidden_owner_mismatch');
  });

  it('sin liquidación → no_liquidacion', async () => {
    const db = makeDb({ selects: [[ASG_DELIVERED], []] });
    const r = await cotizarCobraHoy({
      db: db as never,
      asignacionId: ASG_ID,
      empresaCarrierId: CARRIER_ID,
    });
    expect(r.status).toBe('no_liquidacion');
  });

  it('happy path → ok con desglose', async () => {
    const db = makeDb({ selects: [[ASG_DELIVERED], [LIQ]] });
    const r = await cotizarCobraHoy({
      db: db as never,
      asignacionId: ASG_ID,
      empresaCarrierId: CARRIER_ID,
    });
    expect(r.status).toBe('ok');
    if (r.status === 'ok') {
      expect(r.montoNetoClp).toBe(1_000_000);
      expect(r.tarifaPct).toBe(1.5);
      expect(r.montoAdelantadoClp).toBe(985_000);
    }
  });

  it('plazoDiasShipper custom (60) → tarifa 3%', async () => {
    const db = makeDb({ selects: [[ASG_DELIVERED], [LIQ]] });
    const r = await cotizarCobraHoy({
      db: db as never,
      asignacionId: ASG_ID,
      empresaCarrierId: CARRIER_ID,
      plazoDiasShipper: 60,
    });
    expect(r.status).toBe('ok');
    if (r.status === 'ok') {
      expect(r.tarifaPct).toBe(3.0);
      expect(r.tarifaClp).toBe(30_000);
    }
  });
});
