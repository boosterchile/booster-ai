import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config as appConfig } from '../../src/config.js';
import { __resetDteEmitterCache } from '../../src/services/dte-emitter-factory.js';
import { liquidarTrip } from '../../src/services/liquidar-trip.js';

/**
 * E2E test del flow DTE: liquidarTrip → wire fire-and-forget →
 * emitirDteLiquidacion → factory → MockDteAdapter → folio persistido.
 *
 * **Por qué importa**: cubre la integración real entre los 4 modules
 * sin mockear los services intermediarios. Si alguien rompe el wire
 * post-INSERT, o el mapping de FacturaInput, o el factory caching,
 * este test rompe.
 *
 * **Setup**:
 *   - `DTE_PROVIDER=mock` → factory crea MockDteAdapter real.
 *   - `PRICING_V2_ACTIVATED=true`.
 *   - Mock DB que responde el queue completo de selects + inserts +
 *     updates que el flow necesita.
 *
 * **No es full E2E con HTTP/postgres** (eso vendría con un test
 * integration server + testcontainer postgres). Esto es "unit
 * integration": real services + real adapter, mock DB layer.
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

const ASG_ID = '11111111-1111-1111-1111-111111111111';
const EMPRESA_CARRIER_ID = '22222222-2222-2222-2222-222222222222';
const LIQ_ID = '33333333-3333-3333-3333-333333333333';
const FACTURA_ID = '44444444-4444-4444-4444-444444444444';

const ASG_DELIVERED = {
  id: ASG_ID,
  empresaCarrierId: EMPRESA_CARRIER_ID,
  agreedPriceClp: 1_000_000,
  deliveredAt: new Date('2026-05-10T12:00:00Z'),
};

const CARRIER_MEMBERSHIP_CONSENT_OK = {
  id: 'm1',
  tierSlug: 'free',
  consentTermsV2AceptadoEn: new Date('2026-05-01T00:00:00Z'),
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

const CARRIER_EMPRESA = {
  id: EMPRESA_CARRIER_ID,
  legalName: 'Transportes E2E SpA',
  rut: '76.123.456-7',
  addressStreet: 'Camino Industrial 123',
  addressCity: 'Quilicura',
};

const LIQUIDACION_LISTA = {
  id: LIQ_ID,
  asignacionId: ASG_ID,
  empresaCarrierId: EMPRESA_CARRIER_ID,
  comisionClp: 120000,
  ivaComisionClp: 22800,
  totalFacturaBoosterClp: 142800,
  status: 'lista_para_dte',
  dteFacturaBoosterFolio: null,
  pricingMethodologyVersion: 'pricing-v2.0-cl-2026.06',
};

interface DbCallTracker {
  selectCount: number;
  insertCount: number;
  updateCount: number;
  inserts: Array<{ table: string; values: Record<string, unknown> }>;
  updates: Array<Record<string, unknown>>;
}

function makeFullDb() {
  const tracker: DbCallTracker = {
    selectCount: 0,
    insertCount: 0,
    updateCount: 0,
    inserts: [],
    updates: [],
  };

  // Cola ordenada de respuestas SELECT que el flow consume.
  // 1. liquidarTrip: SELECT assignment.
  // 2. liquidarTrip: SELECT carrierMembership.
  // 3. liquidarTrip: SELECT tier.
  // (4) emitirDteLiquidacion: SELECT liquidacion (existe post-INSERT).
  // (5) emitirDteLiquidacion: SELECT carrier empresa.
  // (6) emitirDteLiquidacion: SELECT factura existing (vacío).
  const selectQueue: unknown[][] = [
    [ASG_DELIVERED],
    [CARRIER_MEMBERSHIP_CONSENT_OK],
    [TIER_FREE],
    [LIQUIDACION_LISTA],
    [CARRIER_EMPRESA],
    [], // factura existing vacío
  ];

  // Cola INSERT returning:
  // 1. liquidarTrip: INSERT liquidaciones returning id.
  // 2. emitirDteLiquidacion: INSERT factura returning id.
  const insertQueue: Array<Array<{ id: string }>> = [[{ id: LIQ_ID }], [{ id: FACTURA_ID }]];

  const buildSelectChain = () => {
    const chain: Record<string, unknown> = {
      from: vi.fn((_table: unknown) => chain),
      where: vi.fn(() => chain),
      limit: vi.fn(async () => {
        tracker.selectCount++;
        return selectQueue.shift() ?? [];
      }),
    };
    return chain;
  };

  const buildInsertChain = (table: string) => ({
    values: vi.fn((vals: Record<string, unknown>) => {
      tracker.inserts.push({ table, values: vals });
      tracker.insertCount++;
      return {
        returning: vi.fn(async () => insertQueue.shift() ?? []),
      };
    }),
  });

  const buildUpdateChain = () => ({
    set: vi.fn((vals: Record<string, unknown>) => {
      tracker.updates.push(vals);
      tracker.updateCount++;
      return {
        where: vi.fn(async () => []),
      };
    }),
  });

  // Map para discriminar tablas en INSERT.
  const db = {
    select: vi.fn(() => buildSelectChain()),
    insert: vi.fn((table: unknown) => {
      const tableName =
        typeof table === 'object' && table !== null && 'Symbol(drizzle:Name)' in table
          ? String((table as { 'Symbol(drizzle:Name)': string })['Symbol(drizzle:Name)'])
          : 'unknown';
      return buildInsertChain(tableName);
    }),
    update: vi.fn(() => buildUpdateChain()),
  };

  return { db, tracker };
}

beforeEach(() => {
  vi.clearAllMocks();
  appConfig.PRICING_V2_ACTIVATED = true;
  appConfig.DTE_PROVIDER = 'mock';
  // Defaults emisor para que SovosAdapter no rechace si alguien cambia
  // DTE_PROVIDER sin notar.
  appConfig.BOOSTER_RUT = '76.000.000-0';
  appConfig.BOOSTER_RAZON_SOCIAL = 'Booster Chile SpA';
  appConfig.BOOSTER_GIRO = 'Marketplace de logística';
  appConfig.BOOSTER_DIRECCION = 'Av. Providencia 1000';
  appConfig.BOOSTER_COMUNA = 'Providencia';
  __resetDteEmitterCache();
});
afterEach(() => {
  __resetDteEmitterCache();
  vi.clearAllMocks();
});

describe('E2E: liquidarTrip → wire DTE → MockDteAdapter', () => {
  it('flow completo: trip entregado con consent → liquidación + DTE emitido', async () => {
    const { db, tracker } = makeFullDb();

    const result = await liquidarTrip({
      db: db as never,
      logger: noopLogger,
      assignmentId: ASG_ID,
      pricingV2Activated: appConfig.PRICING_V2_ACTIVATED,
    });

    // Step 1: liquidarTrip retorna liquidacion_creada.
    expect(result).toEqual({ status: 'liquidacion_creada', liquidacionId: LIQ_ID });

    // Step 2: DB recibió INSERTs (1 liquidación + 1 factura).
    expect(tracker.insertCount).toBe(2);

    // Step 3: emitirDteLiquidacion hizo UPDATEs:
    //   - factura con folio + provider + dte_status='en_proceso'
    //   - liquidación con dte_factura_booster_folio + status='dte_emitido'
    expect(tracker.updateCount).toBe(2);

    const facturaUpdate = tracker.updates[0];
    expect(facturaUpdate?.dteFolio).toBe('1'); // primer folio del MockAdapter
    expect(facturaUpdate?.dteProvider).toBe('mock');
    expect(facturaUpdate?.dteStatus).toBe('en_proceso');
    expect(facturaUpdate?.status).toBe('dte_emitido');

    const liquidacionUpdate = tracker.updates[1];
    expect(liquidacionUpdate?.dteFacturaBoosterFolio).toBe('1');
    expect(liquidacionUpdate?.status).toBe('dte_emitido');
  });

  it('flow completo: emite con datos del emisor Booster desde config', async () => {
    const { db, tracker } = makeFullDb();
    appConfig.BOOSTER_RAZON_SOCIAL = 'Booster Chile SpA — Test';

    await liquidarTrip({
      db: db as never,
      logger: noopLogger,
      assignmentId: ASG_ID,
      pricingV2Activated: appConfig.PRICING_V2_ACTIVATED,
    });

    // El INSERT de factura debe haber recibido el monto neto + IVA
    // calculados por liquidarTrip (12% sobre 1.000.000 = 120.000 + 22.800 IVA).
    const facturaInsert = tracker.inserts.find((i) => i.values.tipo === 'comision_trip');
    expect(facturaInsert).toBeTruthy();
    expect(facturaInsert?.values.subtotalClp).toBe(120000);
    expect(facturaInsert?.values.ivaClp).toBe(22800);
    expect(facturaInsert?.values.totalClp).toBe(142800);
  });

  it('DTE_PROVIDER=disabled → liquidación creada, sin emisión', async () => {
    appConfig.DTE_PROVIDER = 'disabled';
    __resetDteEmitterCache();

    const { db, tracker } = makeFullDb();

    const result = await liquidarTrip({
      db: db as never,
      logger: noopLogger,
      assignmentId: ASG_ID,
      pricingV2Activated: appConfig.PRICING_V2_ACTIVATED,
    });

    expect(result.status).toBe('liquidacion_creada');
    // Sólo el INSERT de la liquidación, no de factura. Sin UPDATEs.
    expect(tracker.insertCount).toBe(1);
    expect(tracker.updateCount).toBe(0);
  });

  it('PRICING_V2_ACTIVATED=false → liquidarTrip skip total', async () => {
    appConfig.PRICING_V2_ACTIVATED = false;
    const { db, tracker } = makeFullDb();

    const result = await liquidarTrip({
      db: db as never,
      logger: noopLogger,
      assignmentId: ASG_ID,
      pricingV2Activated: appConfig.PRICING_V2_ACTIVATED,
    });

    expect(result.status).toBe('skipped_flag_disabled');
    expect(tracker.selectCount).toBe(0);
  });
});

// Tests de state persistente del MockAdapter (folios secuenciales,
// queryStatus cross-call) viven en `packages/dte-provider/test/
// mock-adapter.test.ts` — acá no aplican porque `__resetDteEmitterCache`
// en afterEach descarta el adapter, y compartir state en el mismo test
// requiere bypass de la factory que rompe el spirit del E2E (real
// wire de la factory).
