import {
  DteNotConfiguredError,
  DteProviderRejectedError,
  DteTransientError,
  DteValidationError,
} from '@booster-ai/dte-provider';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config as appConfig } from '../../src/config.js';

vi.mock('../../src/services/dte-emitter-factory.js', () => ({
  getDteEmitter: vi.fn(),
  __resetDteEmitterCache: vi.fn(),
}));

const { getDteEmitter } = await import('../../src/services/dte-emitter-factory.js');
const { emitirDteLiquidacion } = await import('../../src/services/emitir-dte-liquidacion.js');

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
  /** Lista de arrays que cada `.limit(1)` consume secuencialmente. */
  selects?: unknown[][];
  /** Para `INSERT ... RETURNING`. */
  inserts?: unknown[][];
}

function makeDb(opts: DbQueues = {}) {
  const selects = [...(opts.selects ?? [])];
  const inserts = [...(opts.inserts ?? [])];

  const buildSelectChain = () => {
    const chain: Record<string, unknown> = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      limit: vi.fn(async () => selects.shift() ?? []),
    };
    return chain;
  };

  const buildInsertChain = () => ({
    values: vi.fn(() => ({
      returning: vi.fn(async () => inserts.shift() ?? []),
    })),
  });

  const updateSetMock = vi.fn(() => ({
    where: vi.fn(async () => []),
  }));
  const buildUpdateChain = () => ({
    set: updateSetMock,
  });

  return {
    db: {
      select: vi.fn(() => buildSelectChain()),
      insert: vi.fn(() => buildInsertChain()),
      update: vi.fn(() => buildUpdateChain()),
    },
    updateSetMock,
  };
}

const LIQ_ID = '11111111-1111-1111-1111-111111111111';
const CARRIER_ID = '22222222-2222-2222-2222-222222222222';

const LIQ_LISTA = {
  id: LIQ_ID,
  asignacionId: 'asg-1',
  empresaCarrierId: CARRIER_ID,
  comisionClp: 24000,
  ivaComisionClp: 4560,
  totalFacturaBoosterClp: 28560,
  status: 'lista_para_dte',
  dteFacturaBoosterFolio: null,
  pricingMethodologyVersion: 'pricing-v2.0-cl-2026.06',
};

const CARRIER = {
  id: CARRIER_ID,
  legalName: 'Transportes Test SpA',
  rut: '76.123.456-7',
  addressStreet: 'Camino X 123',
  addressCity: 'Quilicura',
};

beforeEach(() => {
  vi.clearAllMocks();
  appConfig.PRICING_V2_ACTIVATED = true;
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('emitirDteLiquidacion — short-circuits', () => {
  it('flag off → skipped:flag_disabled, no DB queries', async () => {
    appConfig.PRICING_V2_ACTIVATED = false;
    const { db } = makeDb();
    const result = await emitirDteLiquidacion({
      db: db as never,
      logger: noopLogger,
      liquidacionId: LIQ_ID,
    });
    expect(result).toEqual({ status: 'skipped', reason: 'flag_disabled' });
    expect(db.select).not.toHaveBeenCalled();
  });

  it('adapter null → skipped:no_adapter', async () => {
    (getDteEmitter as ReturnType<typeof vi.fn>).mockReturnValueOnce(null);
    const { db } = makeDb();
    const result = await emitirDteLiquidacion({
      db: db as never,
      logger: noopLogger,
      liquidacionId: LIQ_ID,
    });
    expect(result).toEqual({ status: 'skipped', reason: 'no_adapter' });
  });

  it('liquidación inexistente → liquidacion_not_found', async () => {
    (getDteEmitter as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      emitFactura: vi.fn(),
    });
    const { db } = makeDb({ selects: [[]] });
    const result = await emitirDteLiquidacion({
      db: db as never,
      logger: noopLogger,
      liquidacionId: LIQ_ID,
    });
    expect(result).toEqual({ status: 'liquidacion_not_found' });
  });

  it('liquidación ya tiene folio → ya_emitido (idempotente)', async () => {
    (getDteEmitter as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      emitFactura: vi.fn(),
    });
    const { db } = makeDb({
      selects: [[{ ...LIQ_LISTA, dteFacturaBoosterFolio: 'folio-99' }]],
    });
    const result = await emitirDteLiquidacion({
      db: db as never,
      logger: noopLogger,
      liquidacionId: LIQ_ID,
    });
    expect(result).toEqual({ status: 'ya_emitido', folio: 'folio-99' });
  });

  it('liquidación en status pending_consent → skipped:no_aplicable', async () => {
    (getDteEmitter as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      emitFactura: vi.fn(),
    });
    const { db } = makeDb({
      selects: [[{ ...LIQ_LISTA, status: 'pending_consent' }]],
    });
    const result = await emitirDteLiquidacion({
      db: db as never,
      logger: noopLogger,
      liquidacionId: LIQ_ID,
    });
    expect(result).toEqual({ status: 'skipped', reason: 'liquidacion_no_aplicable' });
  });

  it('empresa carrier no existe → empresa_carrier_not_found', async () => {
    (getDteEmitter as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      emitFactura: vi.fn(),
    });
    const { db } = makeDb({
      selects: [[LIQ_LISTA], []], // liq OK, carrier vacío
    });
    const result = await emitirDteLiquidacion({
      db: db as never,
      logger: noopLogger,
      liquidacionId: LIQ_ID,
    });
    expect(result).toEqual({ status: 'empresa_carrier_not_found' });
  });
});

describe('emitirDteLiquidacion — happy path', () => {
  it('emite, persiste factura + liquidación con folio', async () => {
    const emitFactura = vi.fn().mockResolvedValue({
      folio: '1234',
      tipo: 33,
      rutEmisor: '76.000.000-0',
      emitidoEn: '2026-05-10T12:00:00Z',
      montoTotalClp: 28560,
      pdfUrl: 'https://mock.dte/1234.pdf',
      providerTrackId: 'track-abc',
    });
    (getDteEmitter as ReturnType<typeof vi.fn>).mockReturnValueOnce({ emitFactura });
    const { db } = makeDb({
      selects: [
        [LIQ_LISTA], // liquidación
        [CARRIER], // carrier
        [], // factura existing vacío
      ],
      inserts: [[{ id: 'factura-new-id' }]],
    });
    const result = await emitirDteLiquidacion({
      db: db as never,
      logger: noopLogger,
      liquidacionId: LIQ_ID,
    });
    expect(result.status).toBe('emitido');
    if (result.status === 'emitido') {
      expect(result.folio).toBe('1234');
      expect(result.facturaId).toBe('factura-new-id');
      expect(result.providerTrackId).toBe('track-abc');
    }
    expect(emitFactura).toHaveBeenCalledTimes(1);
    // Payload contenía datos del emisor desde config.
    const arg = emitFactura.mock.calls[0]?.[0];
    expect(arg.emisor.razonSocial).toBe(appConfig.BOOSTER_RAZON_SOCIAL);
    expect(arg.receptor.rut).toBe(CARRIER.rut);
    expect(arg.items[0]?.montoNetoClp).toBe(24000);
  });

  it('reusa factura placeholder existing si ya hay row sin folio', async () => {
    const emitFactura = vi.fn().mockResolvedValue({
      folio: '5678',
      tipo: 33,
      rutEmisor: '76.000.000-0',
      emitidoEn: '2026-05-10T12:00:00Z',
      montoTotalClp: 28560,
    });
    (getDteEmitter as ReturnType<typeof vi.fn>).mockReturnValueOnce({ emitFactura });
    const { db } = makeDb({
      selects: [[LIQ_LISTA], [CARRIER], [{ id: 'factura-existing-id', dteFolio: null }]],
    });
    const result = await emitirDteLiquidacion({
      db: db as never,
      logger: noopLogger,
      liquidacionId: LIQ_ID,
    });
    expect(result.status).toBe('emitido');
    if (result.status === 'emitido') {
      expect(result.facturaId).toBe('factura-existing-id');
    }
    // No INSERT — reusamos.
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('race: factura existing ya tiene folio → ya_emitido sin re-llamar provider', async () => {
    const emitFactura = vi.fn();
    (getDteEmitter as ReturnType<typeof vi.fn>).mockReturnValueOnce({ emitFactura });
    const { db } = makeDb({
      selects: [[LIQ_LISTA], [CARRIER], [{ id: 'factura-existing-id', dteFolio: 'folio-race-99' }]],
    });
    const result = await emitirDteLiquidacion({
      db: db as never,
      logger: noopLogger,
      liquidacionId: LIQ_ID,
    });
    expect(result).toEqual({ status: 'ya_emitido', folio: 'folio-race-99' });
    expect(emitFactura).not.toHaveBeenCalled();
  });
});

describe('emitirDteLiquidacion — provider errors', () => {
  function setupForProviderError(error: unknown) {
    const emitFactura = vi.fn().mockRejectedValue(error);
    (getDteEmitter as ReturnType<typeof vi.fn>).mockReturnValueOnce({ emitFactura });
    return makeDb({
      selects: [[LIQ_LISTA], [CARRIER], []],
      inserts: [[{ id: 'factura-new-id' }]],
    });
  }

  it('DteNotConfiguredError → skipped:no_adapter', async () => {
    const { db } = setupForProviderError(new DteNotConfiguredError('no creds'));
    const result = await emitirDteLiquidacion({
      db: db as never,
      logger: noopLogger,
      liquidacionId: LIQ_ID,
    });
    expect(result).toEqual({ status: 'skipped', reason: 'no_adapter' });
  });

  it('DteValidationError → validation_error', async () => {
    const { db } = setupForProviderError(new DteValidationError('RUT inválido'));
    const result = await emitirDteLiquidacion({
      db: db as never,
      logger: noopLogger,
      liquidacionId: LIQ_ID,
    });
    expect(result.status).toBe('validation_error');
  });

  it('DteTransientError → transient_error (caller debe reintentar)', async () => {
    const { db } = setupForProviderError(new DteTransientError('timeout'));
    const result = await emitirDteLiquidacion({
      db: db as never,
      logger: noopLogger,
      liquidacionId: LIQ_ID,
    });
    expect(result.status).toBe('transient_error');
  });

  it('DteProviderRejectedError → provider_rejected con código', async () => {
    const { db } = setupForProviderError(new DteProviderRejectedError('cert expirado', '400'));
    const result = await emitirDteLiquidacion({
      db: db as never,
      logger: noopLogger,
      liquidacionId: LIQ_ID,
    });
    expect(result.status).toBe('provider_rejected');
    if (result.status === 'provider_rejected') {
      expect(result.providerCode).toBe('400');
    }
  });

  it('Error desconocido → propaga (no clasifica como transient)', async () => {
    const { db } = setupForProviderError(new Error('bug'));
    await expect(
      emitirDteLiquidacion({
        db: db as never,
        logger: noopLogger,
        liquidacionId: LIQ_ID,
      }),
    ).rejects.toThrow('bug');
  });
});
