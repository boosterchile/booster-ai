import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildAutoMoraNota,
  procesarCobranzaCobraHoy,
} from '../../src/services/procesar-cobranza-cobra-hoy.js';

/**
 * Tests del cron de cobranza Cobra Hoy (ADR-029 v1 / ADR-032).
 *
 * El service hace 1 SELECT (candidatos vencidos) + N UPDATEs (uno por
 * adelanto a `mora`). Los tests mockean ambos.
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

function makeDb(opts: { selectRows: Array<Record<string, unknown>>; updates?: number }) {
  const updateCalls: Array<Record<string, unknown>> = [];

  const selectChain: Record<string, unknown> = {
    from: vi.fn(() => selectChain),
    where: vi.fn(() => selectChain),
    limit: vi.fn(async () => opts.selectRows),
  };

  const updateChain = {
    set: vi.fn((args: Record<string, unknown>) => {
      updateCalls.push(args);
      return {
        where: vi.fn(async () => []),
      };
    }),
  };

  return {
    db: {
      select: vi.fn(() => selectChain),
      update: vi.fn(() => updateChain),
    },
    updateCalls,
  };
}

const CARRIER_A = '11111111-1111-1111-1111-111111111111';
const SHIPPER_A = '22222222-2222-2222-2222-222222222222';
const CARRIER_B = '33333333-3333-3333-3333-333333333333';
const SHIPPER_B = '44444444-4444-4444-4444-444444444444';

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('procesarCobranzaCobraHoy — no-op branches', () => {
  it('sin candidatos vencidos → morasCreadas:0, adelantos:[]', async () => {
    const { db } = makeDb({ selectRows: [] });
    const result = await procesarCobranzaCobraHoy({
      db: db as never,
      logger: noopLogger,
    });
    expect(result.morasCreadas).toBe(0);
    expect(result.adelantos).toEqual([]);
    // No debió haber update.
    expect(db.update).not.toHaveBeenCalled();
  });
});

describe('procesarCobranzaCobraHoy — transición a mora', () => {
  it('1 candidato vencido → 1 UPDATE + result.morasCreadas=1', async () => {
    const desembolsadoEn = new Date('2026-04-01T12:00:00Z'); // ~40 días atrás
    const { db, updateCalls } = makeDb({
      selectRows: [
        {
          id: 'a1',
          empresaCarrierId: CARRIER_A,
          empresaShipperId: SHIPPER_A,
          plazoDiasShipper: 30,
          desembolsadoEn,
        },
      ],
    });
    const result = await procesarCobranzaCobraHoy({
      db: db as never,
      logger: noopLogger,
    });
    expect(result.morasCreadas).toBe(1);
    expect(result.adelantos[0]).toMatchObject({
      adelantoId: 'a1',
      empresaCarrierId: CARRIER_A,
      empresaShipperId: SHIPPER_A,
    });
    expect(result.adelantos[0]?.diasVencidos).toBeGreaterThan(0);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.status).toBe('mora');
    expect(updateCalls[0]?.moraDesde).toBeInstanceOf(Date);
  });

  it('múltiples candidatos → 1 UPDATE por cada uno', async () => {
    const desembolsadoEn = new Date('2026-03-01T12:00:00Z');
    const { db, updateCalls } = makeDb({
      selectRows: [
        {
          id: 'a1',
          empresaCarrierId: CARRIER_A,
          empresaShipperId: SHIPPER_A,
          plazoDiasShipper: 30,
          desembolsadoEn,
        },
        {
          id: 'a2',
          empresaCarrierId: CARRIER_B,
          empresaShipperId: SHIPPER_B,
          plazoDiasShipper: 45,
          desembolsadoEn,
        },
      ],
    });
    const result = await procesarCobranzaCobraHoy({
      db: db as never,
      logger: noopLogger,
    });
    expect(result.morasCreadas).toBe(2);
    expect(updateCalls).toHaveLength(2);
    expect(updateCalls.every((u) => u.status === 'mora')).toBe(true);
  });

  it('candidato sin desembolsadoEn (datos malformados) → se skipea silenciosamente', async () => {
    const { db, updateCalls } = makeDb({
      selectRows: [
        {
          id: 'a1',
          empresaCarrierId: CARRIER_A,
          empresaShipperId: SHIPPER_A,
          plazoDiasShipper: 30,
          desembolsadoEn: null,
        },
      ],
    });
    const result = await procesarCobranzaCobraHoy({
      db: db as never,
      logger: noopLogger,
    });
    expect(result.morasCreadas).toBe(0);
    expect(updateCalls).toHaveLength(0);
  });
});

describe('procesarCobranzaCobraHoy — diasVencidos calculation', () => {
  it('plazo 30d, desembolsado hace 45d → diasVencidos ≈ 15', async () => {
    const ahora = Date.now();
    const desembolsadoEn = new Date(ahora - 45 * 24 * 60 * 60 * 1000);
    const { db } = makeDb({
      selectRows: [
        {
          id: 'a1',
          empresaCarrierId: CARRIER_A,
          empresaShipperId: SHIPPER_A,
          plazoDiasShipper: 30,
          desembolsadoEn,
        },
      ],
    });
    const result = await procesarCobranzaCobraHoy({
      db: db as never,
      logger: noopLogger,
    });
    expect(result.adelantos[0]?.diasVencidos).toBeGreaterThanOrEqual(14);
    expect(result.adelantos[0]?.diasVencidos).toBeLessThanOrEqual(15);
  });

  it('plazo 90d, desembolsado hace 95d → diasVencidos ≈ 5', async () => {
    const ahora = Date.now();
    const desembolsadoEn = new Date(ahora - 95 * 24 * 60 * 60 * 1000);
    const { db } = makeDb({
      selectRows: [
        {
          id: 'a1',
          empresaCarrierId: CARRIER_A,
          empresaShipperId: SHIPPER_A,
          plazoDiasShipper: 90,
          desembolsadoEn,
        },
      ],
    });
    const result = await procesarCobranzaCobraHoy({
      db: db as never,
      logger: noopLogger,
    });
    expect(result.adelantos[0]?.diasVencidos).toBeGreaterThanOrEqual(4);
    expect(result.adelantos[0]?.diasVencidos).toBeLessThanOrEqual(5);
  });
});

describe('buildAutoMoraNota', () => {
  it('formato esperado: [ISO email] auto-mora: ...', () => {
    const nota = buildAutoMoraNota({
      actorEmail: 'cron@boosterchile.com',
      ahora: new Date('2026-05-11T10:00:00Z'),
      plazoDiasShipper: 30,
      diasVencidos: 5,
    });
    expect(nota).toBe(
      '[2026-05-11T10:00:00.000Z cron@boosterchile.com] auto-mora: shipper no pagó en plazo (5 días vencidos sobre 30).',
    );
  });

  it('inyecta diasVencidos y plazo correctamente', () => {
    const nota = buildAutoMoraNota({
      actorEmail: 'admin@boosterchile.com',
      ahora: new Date('2026-05-11T10:00:00Z'),
      plazoDiasShipper: 90,
      diasVencidos: 3,
    });
    expect(nota).toContain('admin@boosterchile.com');
    expect(nota).toContain('(3 días vencidos sobre 90)');
  });
});
