import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emitirCertificadoViaje } from '../../src/services/emitir-certificado-viaje.js';

// Mock @booster-ai/certificate-generator (KMS+GCS+PDF) — el contrato es
// emitirCertificado(opts) → { pdfGcsUri, sigGcsUri, pdfSha256, kmsKeyVersion, issuedAt, pdfBytes }
vi.mock('@booster-ai/certificate-generator', () => ({
  emitirCertificado: vi.fn(),
}));

const { emitirCertificado } = await import('@booster-ai/certificate-generator');

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
  selects?: unknown[][];
  updates?: unknown[][];
  inserts?: unknown[][];
}

function makeDb(queues: DbQueues = {}) {
  const selects = [...(queues.selects ?? [])];
  const updates = [...(queues.updates ?? [])];
  const inserts = [...(queues.inserts ?? [])];

  const buildSelectChain = () => {
    const chain: Record<string, unknown> = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      limit: vi.fn(async () => selects.shift() ?? []),
    };
    return chain;
  };
  const buildUpdateChain = () => ({
    set: vi.fn(() => ({ where: vi.fn(async () => updates.shift() ?? []) })),
  });
  const buildInsertChain = () => ({
    values: vi.fn(async () => inserts.shift() ?? []),
  });

  const tx = {
    select: vi.fn(() => buildSelectChain()),
    update: vi.fn(() => buildUpdateChain()),
    insert: vi.fn(() => buildInsertChain()),
  };

  return {
    transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
    select: tx.select,
    update: tx.update,
    insert: tx.insert,
  };
}

const TRIP_ID = '11111111-1111-1111-1111-111111111111';
const SHIPPER_EMP_ID = 'shipper-emp';
const CARRIER_EMP_ID = 'carrier-emp';

const TRIP_DELIVERED = {
  id: TRIP_ID,
  status: 'entregado',
  generadorCargaEmpresaId: SHIPPER_EMP_ID,
  trackingCode: 'TR-123',
  originAddressRaw: 'Av. X 100, Stgo',
  originRegionCode: 'RM',
  destinationAddressRaw: 'Pto Vpo',
  destinationRegionCode: 'V',
  cargoType: 'carga_seca',
  cargoWeightKg: 5000,
  pickupWindowStart: new Date('2026-05-01T10:00:00Z'),
};

const METRICS_BASE = {
  tripId: TRIP_ID,
  certificateIssuedAt: null,
  distanceKmEstimated: '115.5',
  distanceKmActual: null,
  carbonEmissionsKgco2eEstimated: '37.2',
  carbonEmissionsKgco2eActual: null,
  fuelConsumedLEstimated: '11.5',
  fuelConsumedLActual: null,
  precisionMethod: 'modelado',
  glecVersion: 'v3.0',
  emissionFactorUsed: '3.21',
  calculatedAt: new Date('2026-05-09T10:00:00Z'),
};

const SHIPPER_ROW = { id: SHIPPER_EMP_ID, legalName: 'Shipper SpA', rut: '76.000.000-0' };
const CARRIER_ROW = { legalName: 'Carrier SpA', rut: '76.111.111-1' };

const VALID_CONFIG = {
  kmsKeyId: 'projects/x/locations/us/keyRings/k/cryptoKeys/c',
  certificatesBucket: 'booster-certs',
  verifyBaseUrl: 'https://api.boosterchile.com',
};

const EMITIR_OK = {
  pdfGcsUri: 'gs://booster-certs/cert-abc.pdf',
  sigGcsUri: 'gs://booster-certs/cert-abc.sig',
  pdfSha256: 'abc123',
  kmsKeyVersion: '1',
  issuedAt: new Date('2026-05-10T12:00:00Z'),
  pdfBytes: 45678,
};

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('emitirCertificadoViaje', () => {
  it('config_missing si falta kmsKeyId', async () => {
    const db = makeDb();
    const result = await emitirCertificadoViaje({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
      config: { certificatesBucket: 'b', verifyBaseUrl: 'u' },
    });
    expect(result).toEqual({ skipped: true, reason: 'config_missing' });
  });

  it('config_missing si falta certificatesBucket', async () => {
    const db = makeDb();
    const result = await emitirCertificadoViaje({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
      config: { kmsKeyId: 'k', verifyBaseUrl: 'u' },
    });
    expect(result).toEqual({ skipped: true, reason: 'config_missing' });
  });

  it('trip_not_found si trip no existe', async () => {
    const db = makeDb({ selects: [[]] });
    const result = await emitirCertificadoViaje({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
      config: VALID_CONFIG,
    });
    expect(result).toEqual({ skipped: true, reason: 'trip_not_found' });
  });

  it('trip_not_delivered si trip status != entregado', async () => {
    const db = makeDb({
      selects: [[{ ...TRIP_DELIVERED, status: 'asignado' }]],
    });
    const result = await emitirCertificadoViaje({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
      config: VALID_CONFIG,
    });
    expect(result).toEqual({ skipped: true, reason: 'trip_not_delivered' });
  });

  it('metrics_missing si tripMetrics no existe', async () => {
    const db = makeDb({
      selects: [[TRIP_DELIVERED], []], // trip OK, metrics vacío
    });
    const result = await emitirCertificadoViaje({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
      config: VALID_CONFIG,
    });
    expect(result).toEqual({ skipped: true, reason: 'metrics_missing' });
  });

  it('already_issued (idempotente) si certificateIssuedAt no null', async () => {
    const db = makeDb({
      selects: [
        [TRIP_DELIVERED],
        [{ ...METRICS_BASE, certificateIssuedAt: new Date('2026-05-09T10:00:00Z') }],
      ],
    });
    const result = await emitirCertificadoViaje({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
      config: VALID_CONFIG,
    });
    expect(result).toEqual({ skipped: true, reason: 'already_issued' });
  });

  it('no_shipper si trip.generadorCargaEmpresaId es null', async () => {
    const db = makeDb({
      selects: [[{ ...TRIP_DELIVERED, generadorCargaEmpresaId: null }], [METRICS_BASE]],
    });
    const result = await emitirCertificadoViaje({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
      config: VALID_CONFIG,
    });
    expect(result).toEqual({ skipped: true, reason: 'no_shipper' });
  });

  it('shipper FK rota → trip_not_found defensivo', async () => {
    const db = makeDb({
      selects: [
        [TRIP_DELIVERED],
        [METRICS_BASE],
        [], // shipper SELECT vacío (FK rota)
      ],
    });
    const result = await emitirCertificadoViaje({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
      config: VALID_CONFIG,
    });
    expect(result).toEqual({ skipped: true, reason: 'trip_not_found' });
  });

  it('happy path: emite con shipper + assignment + carrier + vehicle', async () => {
    (emitirCertificado as ReturnType<typeof vi.fn>).mockResolvedValueOnce(EMITIR_OK);
    const db = makeDb({
      selects: [
        [TRIP_DELIVERED],
        [METRICS_BASE],
        [SHIPPER_ROW],
        [{ empresaId: CARRIER_EMP_ID, vehicleId: 'veh-uuid' }],
        [CARRIER_ROW],
        [{ plate: 'AB-CD-12' }],
      ],
      updates: [[]],
      inserts: [[]],
    });
    const result = await emitirCertificadoViaje({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
      config: VALID_CONFIG,
    });
    if (result.skipped) {
      throw new Error('expected emitted');
    }
    expect(result.pdfSha256).toBe('abc123');
    expect(emitirCertificado).toHaveBeenCalledTimes(1);
  });

  it('happy path SIN assignment (cert solo con shipper)', async () => {
    (emitirCertificado as ReturnType<typeof vi.fn>).mockResolvedValueOnce(EMITIR_OK);
    const db = makeDb({
      selects: [
        [TRIP_DELIVERED],
        [METRICS_BASE],
        [SHIPPER_ROW],
        [], // assignment vacío
      ],
      updates: [[]],
      inserts: [[]],
    });
    const result = await emitirCertificadoViaje({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
      config: VALID_CONFIG,
    });
    if (result.skipped) {
      throw new Error('expected emitted');
    }
    expect(result.kmsKeyVersion).toBe('1');
  });

  it('assignment con carrier FK rota → emite sin transportista', async () => {
    (emitirCertificado as ReturnType<typeof vi.fn>).mockResolvedValueOnce(EMITIR_OK);
    const db = makeDb({
      selects: [
        [TRIP_DELIVERED],
        [METRICS_BASE],
        [SHIPPER_ROW],
        [{ empresaId: CARRIER_EMP_ID, vehicleId: null }], // assignment sin vehicleId
        [], // carrier vacío
      ],
      updates: [[]],
      inserts: [[]],
    });
    const result = await emitirCertificadoViaje({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
      config: VALID_CONFIG,
    });
    if (result.skipped) {
      throw new Error('expected emitted');
    }
    expect(result.pdfBytes).toBe(45678);
  });

  it('métricas con valores actuales (no estimated) las preferenciar', async () => {
    (emitirCertificado as ReturnType<typeof vi.fn>).mockResolvedValueOnce(EMITIR_OK);
    const db = makeDb({
      selects: [
        [TRIP_DELIVERED],
        [
          {
            ...METRICS_BASE,
            distanceKmActual: '120.0',
            carbonEmissionsKgco2eActual: '38.5',
            fuelConsumedLActual: '12.0',
          },
        ],
        [SHIPPER_ROW],
        [],
      ],
      updates: [[]],
      inserts: [[]],
    });
    await emitirCertificadoViaje({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
      config: VALID_CONFIG,
    });
    const call = (emitirCertificado as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      metricas: { distanciaKmActual: number | null; combustibleConsumido: number | null };
    };
    expect(call.metricas.distanciaKmActual).toBe(120);
    expect(call.metricas.combustibleConsumido).toBe(12);
  });

  it('emisión exitosa persiste con UPDATE tripMetrics + INSERT tripEvent', async () => {
    (emitirCertificado as ReturnType<typeof vi.fn>).mockResolvedValueOnce(EMITIR_OK);
    const db = makeDb({
      selects: [[TRIP_DELIVERED], [METRICS_BASE], [SHIPPER_ROW], []],
      updates: [[]],
      inserts: [[]],
    });
    await emitirCertificadoViaje({
      db: db as never,
      logger: noopLogger,
      tripId: TRIP_ID,
      config: VALID_CONFIG,
    });
    expect(db.transaction).toHaveBeenCalled();
  });
});
