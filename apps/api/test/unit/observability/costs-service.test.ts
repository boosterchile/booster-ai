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

  it('getOverview: delta apples-to-apples vs mismo periodo mes anterior', async () => {
    // Fila única: [thisMonthMtd, prevMonthSamePeriod, prevMonthFull, currency, last_export]
    // Día 13 del mes — MTD 100k vs mismos 13 días del mes anterior 90k → +11.1%.
    // Mes anterior completo 200k (contexto, no usado en delta).
    const fetchImpl = makeBqFetch(
      [['100000', '90000', '200000', 'CLP', '2026-05-13T13:00:00Z']],
      ['this_month_mtd', 'prev_month_same_period', 'prev_month_full', 'currency', 'last_export'],
    );
    const svc = buildService(fetchImpl);
    const result = await svc.getOverview();
    expect(result.costClpMonthToDate).toBe(100_000);
    expect(result.costClpPreviousMonthSamePeriod).toBe(90_000);
    expect(result.costClpPreviousMonth).toBe(200_000);
    expect(result.deltaPercentVsPreviousMonth).toBeCloseTo(11.1, 1);
    expect(result.lastBillingExportAt).toBe('2026-05-13T13:00:00Z');
  });

  it('getOverview: delta NO compara contra mes completo (evita falso "−83%")', async () => {
    // Día 5 del mes, MTD muy bajo. Si comparáramos contra mes-completo
    // anterior (500k) daría "−96%" — falsa lectura. Con apples-to-apples
    // comparamos contra primeros 5 días del mes anterior (15k): MTD 17k →
    // delta = +13.3% (representativo del ritmo).
    const fetchImpl = makeBqFetch(
      [['17000', '15000', '500000', 'CLP', '2026-05-05T13:00:00Z']],
      ['this_month_mtd', 'prev_month_same_period', 'prev_month_full', 'currency', 'last_export'],
    );
    const svc = buildService(fetchImpl);
    const result = await svc.getOverview();
    expect(result.deltaPercentVsPreviousMonth).toBeCloseTo(13.3, 1);
    expect(result.deltaPercentVsPreviousMonth).not.toBeCloseTo(-96.6, 1);
  });

  it('getOverview: convierte USD a CLP cuando currency=USD', async () => {
    const fetchImpl = makeBqFetch(
      [['100', '90', '200', 'USD', '2026-05-13T13:00:00Z']],
      ['this_month_mtd', 'prev_month_same_period', 'prev_month_full', 'currency', 'last_export'],
    );
    const svc = buildService(fetchImpl);
    const result = await svc.getOverview();
    expect(result.costClpMonthToDate).toBe(100_000); // 100 USD × 1000
    expect(result.costClpPreviousMonthSamePeriod).toBe(90_000);
    expect(result.costClpPreviousMonth).toBe(200_000);
  });

  it('getOverview: prevSamePeriod=0 → deltaPercent=null (no division)', async () => {
    const fetchImpl = makeBqFetch(
      [['50000', '0', '40000', 'CLP', '2026-05-01T13:00:00Z']],
      ['this_month_mtd', 'prev_month_same_period', 'prev_month_full', 'currency', 'last_export'],
    );
    const svc = buildService(fetchImpl);
    const result = await svc.getOverview();
    expect(result.costClpMonthToDate).toBe(50_000);
    expect(result.costClpPreviousMonthSamePeriod).toBe(0);
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

  it('getMonthlyHistory: serie ordenada con delta encadenado entre meses cerrados', async () => {
    // Usamos 3 meses 2024 (cerrados) para que ninguno coincida con el
    // currentMonth y todos lleven delta calculado.
    const fetchImpl = makeBqFetch(
      [
        ['2024-03', '300000', 'CLP'],
        ['2024-04', '450000', 'CLP'], // +50% vs mar
        ['2024-05', '405000', 'CLP'], // -10% vs abr
      ],
      ['month', 'net_cost', 'currency'],
    );
    const svc = buildService(fetchImpl);
    const result = await svc.getMonthlyHistory(3);
    expect(result).toHaveLength(3);
    expect(result[0]?.month).toBe('2024-03');
    expect(result[0]?.deltaPercentVsPrior).toBeNull(); // primer mes sin delta
    expect(result[1]?.deltaPercentVsPrior).toBeCloseTo(50.0, 1);
    expect(result[2]?.deltaPercentVsPrior).toBeCloseTo(-10.0, 1);
  });

  it('getMonthlyHistory: mes en curso → isCurrent=true + delta=null (no apples-to-apples)', async () => {
    const currentMonth = new Date().toISOString().slice(0, 7);
    const fetchImpl = makeBqFetch(
      [
        ['2024-01', '100000', 'CLP'],
        [currentMonth, '50000', 'CLP'],
      ],
      ['month', 'net_cost', 'currency'],
    );
    const svc = buildService(fetchImpl);
    const result = await svc.getMonthlyHistory(12);
    expect(result[0]?.isCurrent).toBe(false);
    expect(result[1]?.isCurrent).toBe(true);
    // El mes actual NO calcula delta (MTD vs mes-completo sería engañoso).
    expect(result[1]?.deltaPercentVsPrior).toBeNull();
  });

  it('getMonthlyHistory: clampea months a [1, 24]', async () => {
    let capturedSql = '';
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as { query: string };
      capturedSql = body.query;
      return {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({
          jobComplete: true,
          schema: { fields: [{ name: 'month' }] },
          rows: [],
        }),
      };
    }) as unknown as typeof fetch;
    const svc = buildService(fetchImpl);
    await svc.getMonthlyHistory(999);
    // 24 meses - 1 = 23 (offset desde el mes actual)
    expect(capturedSql).toContain('INTERVAL 23 MONTH');
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
      [['100', '90', '200', 'EUR', '2026-05-13T13:00:00Z']],
      ['this_month_mtd', 'prev_month_same_period', 'prev_month_full', 'currency', 'last_export'],
    );
    const svc = buildService(fetchImpl);
    const result = await svc.getOverview();
    expect(result.costClpMonthToDate).toBe(100); // raw passthrough
    expect(fakeLogger.warn).toHaveBeenCalled();
  });
});
