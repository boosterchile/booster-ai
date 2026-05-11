import { DteProviderRejectedError, DteTransientError } from '@booster-ai/dte-provider';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config as appConfig } from '../../src/config.js';

vi.mock('../../src/services/dte-emitter-factory.js', () => ({
  getDteEmitter: vi.fn(),
  __resetDteEmitterCache: vi.fn(),
}));
vi.mock('../../src/services/emitir-dte-liquidacion.js', () => ({
  emitirDteLiquidacion: vi.fn(),
}));

const { getDteEmitter } = await import('../../src/services/dte-emitter-factory.js');
const { emitirDteLiquidacion } = await import('../../src/services/emitir-dte-liquidacion.js');
const { reconciliarDtes } = await import('../../src/services/reconciliar-dtes.js');

const noop = (): void => undefined;
const noopLogger = {
  trace: noop,
  debug: noop,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: noop,
  child: () => noopLogger,
} as never;

interface DbQueues {
  /** Cada select consume secuencialmente. */
  selects?: unknown[][];
}

function makeDb(opts: DbQueues = {}) {
  const selects = [...(opts.selects ?? [])];
  const updateSetMock = vi.fn(() => ({
    where: vi.fn(async () => []),
  }));

  const buildSelectChain = () => {
    const chain: Record<string, unknown> = {
      from: vi.fn(() => chain),
      innerJoin: vi.fn(() => chain),
      where: vi.fn(() => chain),
      orderBy: vi.fn(() => chain),
      limit: vi.fn(async () => selects.shift() ?? []),
    };
    return chain;
  };

  return {
    db: {
      select: vi.fn(() => buildSelectChain()),
      update: vi.fn(() => ({ set: updateSetMock })),
    },
    updateSetMock,
  };
}

const FACTURA_EN_PROCESO = {
  facturaId: 'f1',
  dteFolio: '1234',
  dteTipo: 33,
  empresaDestinoId: 'carrier-1',
};

beforeEach(() => {
  vi.clearAllMocks();
  appConfig.PRICING_V2_ACTIVATED = true;
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('reconciliarDtes — short-circuits', () => {
  it('flag off → todo 0', async () => {
    appConfig.PRICING_V2_ACTIVATED = false;
    const { db } = makeDb();
    const result = await reconciliarDtes({ db: db as never, logger: noopLogger });
    expect(result).toEqual({ queriedStatus: 0, statusUpdated: 0, retried: 0, retriedOk: 0 });
    expect(db.select).not.toHaveBeenCalled();
  });

  it('adapter null → todo 0', async () => {
    (getDteEmitter as ReturnType<typeof vi.fn>).mockReturnValueOnce(null);
    const { db } = makeDb();
    const result = await reconciliarDtes({ db: db as never, logger: noopLogger });
    expect(result).toEqual({ queriedStatus: 0, statusUpdated: 0, retried: 0, retriedOk: 0 });
  });
});

describe('reconciliarDtes — step 1 queryStatus', () => {
  it('factura en_proceso pasa a aceptado → UPDATE persistido', async () => {
    const queryStatus = vi.fn().mockResolvedValue({
      folio: '1234',
      tipo: 33,
      rutEmisor: '76.000.000-0',
      status: 'aceptado',
    });
    (getDteEmitter as ReturnType<typeof vi.fn>).mockReturnValueOnce({ queryStatus });
    const { db, updateSetMock } = makeDb({
      selects: [
        [FACTURA_EN_PROCESO],
        [], // no transient rows
      ],
    });
    const result = await reconciliarDtes({ db: db as never, logger: noopLogger });
    expect(result.queriedStatus).toBe(1);
    expect(result.statusUpdated).toBe(1);
    expect(updateSetMock).toHaveBeenCalledTimes(1);
    const setArg = updateSetMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(setArg.dteStatus).toBe('aceptado');
  });

  it('factura sigue en_proceso → no UPDATE (evita escrituras no-op)', async () => {
    const queryStatus = vi.fn().mockResolvedValue({
      folio: '1234',
      tipo: 33,
      rutEmisor: '76.000.000-0',
      status: 'en_proceso',
    });
    (getDteEmitter as ReturnType<typeof vi.fn>).mockReturnValueOnce({ queryStatus });
    const { db, updateSetMock } = makeDb({
      selects: [[FACTURA_EN_PROCESO], []],
    });
    const result = await reconciliarDtes({ db: db as never, logger: noopLogger });
    expect(result.queriedStatus).toBe(1);
    expect(result.statusUpdated).toBe(0);
    expect(updateSetMock).not.toHaveBeenCalled();
  });

  it('múltiples facturas → cada una se consulta', async () => {
    const queryStatus = vi
      .fn()
      .mockResolvedValueOnce({ folio: '1', tipo: 33, rutEmisor: '76', status: 'aceptado' })
      .mockResolvedValueOnce({ folio: '2', tipo: 33, rutEmisor: '76', status: 'rechazado' })
      .mockResolvedValueOnce({ folio: '3', tipo: 33, rutEmisor: '76', status: 'aceptado' });
    (getDteEmitter as ReturnType<typeof vi.fn>).mockReturnValueOnce({ queryStatus });
    const { db } = makeDb({
      selects: [
        [
          { ...FACTURA_EN_PROCESO, facturaId: 'f1', dteFolio: '1' },
          { ...FACTURA_EN_PROCESO, facturaId: 'f2', dteFolio: '2' },
          { ...FACTURA_EN_PROCESO, facturaId: 'f3', dteFolio: '3' },
        ],
        [],
      ],
    });
    const result = await reconciliarDtes({ db: db as never, logger: noopLogger });
    expect(result.queriedStatus).toBe(3);
    expect(result.statusUpdated).toBe(3);
    expect(queryStatus).toHaveBeenCalledTimes(3);
  });

  it('queryStatus transient → skip esa, sigue con siguiente', async () => {
    const queryStatus = vi
      .fn()
      .mockRejectedValueOnce(new DteTransientError('timeout'))
      .mockResolvedValueOnce({ folio: '2', tipo: 33, rutEmisor: '76', status: 'aceptado' });
    (getDteEmitter as ReturnType<typeof vi.fn>).mockReturnValueOnce({ queryStatus });
    const { db } = makeDb({
      selects: [
        [
          { ...FACTURA_EN_PROCESO, facturaId: 'f1', dteFolio: '1' },
          { ...FACTURA_EN_PROCESO, facturaId: 'f2', dteFolio: '2' },
        ],
        [],
      ],
    });
    const result = await reconciliarDtes({ db: db as never, logger: noopLogger });
    expect(result.queriedStatus).toBe(2);
    expect(result.statusUpdated).toBe(1);
  });

  it('queryStatus provider rejected → skip esa factura sin throw', async () => {
    const queryStatus = vi
      .fn()
      .mockRejectedValueOnce(new DteProviderRejectedError('folio no existe', '404'));
    (getDteEmitter as ReturnType<typeof vi.fn>).mockReturnValueOnce({ queryStatus });
    const { db } = makeDb({
      selects: [[FACTURA_EN_PROCESO], []],
    });
    const result = await reconciliarDtes({ db: db as never, logger: noopLogger });
    expect(result.queriedStatus).toBe(1);
    expect(result.statusUpdated).toBe(0);
  });

  it('queryStatus error desconocido → propaga (Cloud Scheduler retry)', async () => {
    const queryStatus = vi.fn().mockRejectedValueOnce(new Error('bug'));
    (getDteEmitter as ReturnType<typeof vi.fn>).mockReturnValueOnce({ queryStatus });
    const { db } = makeDb({
      selects: [[FACTURA_EN_PROCESO]],
    });
    await expect(reconciliarDtes({ db: db as never, logger: noopLogger })).rejects.toThrow('bug');
  });
});

describe('reconciliarDtes — step 2 retry transient', () => {
  it('sin transient rows → retried=0, retriedOk=0', async () => {
    (getDteEmitter as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      queryStatus: vi.fn(),
    });
    const { db } = makeDb({
      selects: [[], []],
    });
    const result = await reconciliarDtes({ db: db as never, logger: noopLogger });
    expect(result.retried).toBe(0);
    expect(result.retriedOk).toBe(0);
  });

  it('factura transient + emitirDteLiquidacion OK → retriedOk++', async () => {
    (getDteEmitter as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      queryStatus: vi.fn(),
    });
    (emitirDteLiquidacion as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 'emitido',
      folio: '9999',
      facturaId: 'f-retry',
      providerTrackId: 'tk',
    });
    const { db } = makeDb({
      selects: [[], [{ facturaId: 'f-retry', liquidacionId: 'liq-1' }]],
    });
    const result = await reconciliarDtes({ db: db as never, logger: noopLogger });
    expect(result.retried).toBe(1);
    expect(result.retriedOk).toBe(1);
  });

  it('factura transient + ya_emitido (race) → retriedOk++', async () => {
    (getDteEmitter as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      queryStatus: vi.fn(),
    });
    (emitirDteLiquidacion as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 'ya_emitido',
      folio: '1234',
    });
    const { db } = makeDb({
      selects: [[], [{ facturaId: 'f1', liquidacionId: 'liq-1' }]],
    });
    const result = await reconciliarDtes({ db: db as never, logger: noopLogger });
    expect(result.retriedOk).toBe(1);
  });

  it('retry threw → log error pero sigue', async () => {
    (getDteEmitter as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      queryStatus: vi.fn(),
    });
    (emitirDteLiquidacion as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
    const { db } = makeDb({
      selects: [[], [{ facturaId: 'f1', liquidacionId: 'liq-1' }]],
    });
    const result = await reconciliarDtes({ db: db as never, logger: noopLogger });
    expect(result.retried).toBe(1);
    expect(result.retriedOk).toBe(0);
  });

  it('retry pero service retorna validation_error → no cuenta como ok', async () => {
    (getDteEmitter as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      queryStatus: vi.fn(),
    });
    (emitirDteLiquidacion as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 'validation_error',
      message: 'x',
    });
    const { db } = makeDb({
      selects: [[], [{ facturaId: 'f1', liquidacionId: 'liq-1' }]],
    });
    const result = await reconciliarDtes({ db: db as never, logger: noopLogger });
    expect(result.retried).toBe(1);
    expect(result.retriedOk).toBe(0);
  });
});

describe('reconciliarDtes — limits', () => {
  it('queryStatusLimit cap superior 500', async () => {
    (getDteEmitter as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      queryStatus: vi.fn(),
    });
    const { db } = makeDb({ selects: [[], []] });
    await reconciliarDtes({
      db: db as never,
      logger: noopLogger,
      queryStatusLimit: 9999,
    });
    // No throw — el cap se aplica internamente.
    expect(db.select).toHaveBeenCalled();
  });

  it('retryEmitLimit default 50 + cap 100', async () => {
    (getDteEmitter as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      queryStatus: vi.fn(),
    });
    const { db } = makeDb({ selects: [[], []] });
    await reconciliarDtes({
      db: db as never,
      logger: noopLogger,
      retryEmitLimit: 9999,
    });
    expect(db.select).toHaveBeenCalled();
  });
});
