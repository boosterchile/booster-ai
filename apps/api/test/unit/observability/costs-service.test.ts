import type { Logger } from '@booster-ai/logger';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ObservabilityCache } from '../../../src/services/observability/cache.js';
import { CostsService } from '../../../src/services/observability/costs-service.js';
import type { FxRateService } from '../../../src/services/observability/fx-rate-service.js';

/**
 * Tests del CostsService. Mocks:
 * - cache: in-memory passthrough (igual al patrón de fx-rate-service.test).
 * - fxRateService: stub que retorna usdToClp determinístico.
 * - fetch: stub que retorna respuestas BQ con schema simulado.
 * - getAccessToken: retorna un token fake (evita ADC en CI).
 */

class InMemoryCacheStub {
  private readonly store = new Map<string, unknown>();
  async getOrFetch<T>(key: string, _ttl: number, fetcher: () => Promise<T>): Promise<T> {
    if (this.store.has(key)) {
      return this.store.get(key) as T;
    }
    const value = await fetcher();
    this.store.set(key, value);
    return value;
  }
  async invalidate(key: string): Promise<void> {
    this.store.delete(key);
  }
  _clear(): void {
    this.store.clear();
  }
}

const fakeLogger: Logger = {
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
  child: () => fakeLogger,
} as unknown as Logger;

const fakeFx = {
  usdToClp: vi.fn(async (usd: number) => usd * 1000),
} as unknown as FxRateService;

function makeBqFetch(rows: Array<Array<string | null>>, fields: string[]): typeof fetch {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => '',
    json: async () => ({
      jobComplete: true,
      schema: { fields: fields.map((name) => ({ name })) },
      rows: rows.map((r) => ({ f: r.map((v) => ({ v })) })),
    }),
  })) as unknown as typeof fetch;
}

function buildService(fetchImpl: typeof fetch): CostsService {
  return new CostsService({
    cache: new InMemoryCacheStub() as unknown as ObservabilityCache,
    fxRateService: fakeFx,
    logger: fakeLogger,
    billingExportTable: 'p.d.t',
    queryProjectId: 'p',
    fetchImpl,
    getAccessToken: async () => 'fake-token',
  });
}

describe('CostsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getOverview: calcula MTD + previous month + delta% (CLP nativo)', async () => {
    const fetchImpl = makeBqFetch(
      [
        ['2026-05-01', '100000', 'CLP', '2026-05-13T13:00:00Z'], // mes actual
        ['2026-04-01', '90000', 'CLP', '2026-05-13T13:00:00Z'], // mes anterior
      ],
      ['month', 'net_cost', 'currency', 'last_export'],
    );
    const svc = buildService(fetchImpl);
    const result = await svc.getOverview();
    expect(result.costClpMonthToDate).toBe(100_000);
    expect(result.costClpPreviousMonth).toBe(90_000);
    expect(result.deltaPercentVsPreviousMonth).toBeCloseTo(11.1, 1);
    expect(result.lastBillingExportAt).toBe('2026-05-13T13:00:00Z');
  });

  it('getOverview: convierte USD a CLP cuando currency=USD', async () => {
    const fetchImpl = makeBqFetch(
      [
        ['2026-05-01', '100', 'USD', '2026-05-13T13:00:00Z'],
        ['2026-04-01', '90', 'USD', '2026-05-13T13:00:00Z'],
      ],
      ['month', 'net_cost', 'currency', 'last_export'],
    );
    const svc = buildService(fetchImpl);
    const result = await svc.getOverview();
    expect(result.costClpMonthToDate).toBe(100_000); // 100 USD × 1000
    expect(result.costClpPreviousMonth).toBe(90_000);
  });

  it('getOverview: previousMonth=0 → deltaPercent=null', async () => {
    const fetchImpl = makeBqFetch(
      [['2026-05-01', '50000', 'CLP', '2026-05-13T13:00:00Z']],
      ['month', 'net_cost', 'currency', 'last_export'],
    );
    const svc = buildService(fetchImpl);
    const result = await svc.getOverview();
    expect(result.costClpMonthToDate).toBe(50_000);
    expect(result.costClpPreviousMonth).toBe(0);
    expect(result.deltaPercentVsPreviousMonth).toBeNull();
  });

  it('getByService: incluye percentOfTotal y ordena desc', async () => {
    const fetchImpl = makeBqFetch(
      [
        ['Cloud Run', '60000', 'CLP'],
        ['Cloud SQL', '30000', 'CLP'],
        ['Pub/Sub', '10000', 'CLP'],
      ],
      ['service', 'net_cost', 'currency'],
    );
    const svc = buildService(fetchImpl);
    const result = await svc.getByService(30);
    expect(result).toHaveLength(3);
    expect(result[0]?.service).toBe('Cloud Run');
    expect(result[0]?.percentOfTotal).toBe(60);
    expect(result[2]?.service).toBe('Pub/Sub');
    expect(result[2]?.percentOfTotal).toBe(10);
  });

  it('getByService: range > 90 días se clampa a 90', async () => {
    let capturedBody = '';
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedBody = init?.body as string;
      return {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({
          jobComplete: true,
          schema: { fields: [{ name: 'service' }] },
          rows: [],
        }),
      };
    }) as unknown as typeof fetch;
    const svc = buildService(fetchImpl);
    await svc.getByService(999);
    expect(capturedBody).toContain('INTERVAL 90 DAY');
  });

  it('getTrend: retorna serie diaria ordenada por fecha', async () => {
    const fetchImpl = makeBqFetch(
      [
        ['2026-05-10', '8000', 'CLP'],
        ['2026-05-11', '9000', 'CLP'],
        ['2026-05-12', '7500', 'CLP'],
      ],
      ['day', 'net_cost', 'currency'],
    );
    const svc = buildService(fetchImpl);
    const result = await svc.getTrend(7);
    expect(result).toHaveLength(3);
    expect(result[0]?.date).toBe('2026-05-10');
    expect(result[0]?.costClp).toBe(8000);
  });

  it('getByProject: filtra null + calcula percentOfTotal', async () => {
    const fetchImpl = makeBqFetch(
      [
        ['booster-ai-494222', 'booster-ai', '75000', 'CLP'],
        ['booster-legacy', 'Booster Legacy', '25000', 'CLP'],
      ],
      ['project_id', 'project_name', 'net_cost', 'currency'],
    );
    const svc = buildService(fetchImpl);
    const result = await svc.getByProject(30);
    expect(result).toHaveLength(2);
    expect(result[0]?.projectId).toBe('booster-ai-494222');
    expect(result[0]?.percentOfTotal).toBe(75);
  });

  it('getTopSkus: pasa LIMIT al SQL y mapea resultados', async () => {
    let capturedBody = '';
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedBody = init?.body as string;
      // BQ aplicaría el LIMIT — el mock retorna sólo 5 filas (las top).
      const rows = Array.from({ length: 5 }, (_, i) => [
        `Service ${i}`,
        `SKU ${i}`,
        String(1000 * (5 - i)),
        'CLP',
      ]);
      return {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({
          jobComplete: true,
          schema: { fields: [{ name: 'service' }, { name: 'sku' }, { name: 'net_cost' }] },
          rows: rows.map((r) => ({ f: r.map((v) => ({ v })) })),
        }),
      };
    }) as unknown as typeof fetch;
    const svc = buildService(fetchImpl);
    const result = await svc.getTopSkus(5);
    expect(capturedBody).toContain('LIMIT 5');
    expect(result).toHaveLength(5);
    expect(result[0]?.costClp).toBe(5000);
  });

  it('runQuery: BQ error response → throw', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => 'internal error',
      json: async () => ({}),
    })) as unknown as typeof fetch;
    const svc = buildService(fetchImpl);
    await expect(svc.getOverview()).rejects.toThrow(/BigQuery query failed/);
  });

  it('runQuery: BQ retorna jobComplete=false → throw', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({ jobComplete: false }),
    })) as unknown as typeof fetch;
    const svc = buildService(fetchImpl);
    await expect(svc.getOverview()).rejects.toThrow(/did not complete/);
  });

  it('toClp: currency desconocida → loggea warn pero no crashea', async () => {
    const fetchImpl = makeBqFetch(
      [
        ['2026-05-01', '100', 'EUR'],
        ['2026-04-01', '90', 'EUR'],
      ],
      ['month', 'net_cost', 'currency'],
    );
    const svc = buildService(fetchImpl);
    const result = await svc.getOverview();
    expect(result.costClpMonthToDate).toBe(100); // raw passthrough
    expect(fakeLogger.warn).toHaveBeenCalled();
  });
});
