import type { Logger } from '@booster-ai/logger';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ObservabilityCache } from '../../../src/services/observability/cache.js';
import type { FxRateService } from '../../../src/services/observability/fx-rate-service.js';
import {
  type WorkspaceAdminClient,
  WorkspaceService,
} from '../../../src/services/observability/workspace-service.js';

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
  usdToClp: vi.fn(async (usd: number) => Math.round(usd * 925)),
} as unknown as FxRateService;

const priceMap = { starter: 6, standard: 12, plus: 18, enterprise: 30 };

function build(adminClient: WorkspaceAdminClient | null, domain = 'boosterchile.com') {
  return new WorkspaceService({
    cache: new InMemoryCacheStub() as unknown as ObservabilityCache,
    fxRateService: fakeFx,
    logger: fakeLogger,
    domain,
    priceMap,
    ...(adminClient ? { adminClient } : {}),
  });
}

describe('WorkspaceService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('domain vacío → available=false con reason', async () => {
    const svc = build(null, '');
    const result = await svc.getUsageSnapshot();
    expect(result.available).toBe(false);
    expect(result.reason).toContain('GOOGLE_WORKSPACE_DOMAIN');
  });

  it('adminClient ausente → available=false con reason DWD', async () => {
    const svc = build(null);
    const result = await svc.getUsageSnapshot();
    expect(result.available).toBe(false);
    expect(result.reason).toContain('DWD');
  });

  it('licensing API ok → calcula costo por SKU usando priceMap', async () => {
    const adminClient: WorkspaceAdminClient = {
      listUsers: vi.fn(async () => ({ activeUsers: 5, suspendedUsers: 1 })),
      listLicenseAssignments: vi.fn(async () => [
        { skuId: '1010020027' }, // starter × 6
        { skuId: '1010020028' }, // standard × 12
        { skuId: '1010020028' }, // standard × 12
        { skuId: '1010020025' }, // plus × 18
        { skuId: '1010060003' }, // enterprise × 30
      ]),
    };
    const svc = build(adminClient);
    const result = await svc.getUsageSnapshot();
    expect(result.available).toBe(true);
    expect(result.totalSeats).toBe(6);
    expect(result.activeSeats).toBe(5);
    expect(result.suspendedSeats).toBe(1);
    expect(result.monthlyCostUsd).toBe(78); // 6+12+12+18+30
    expect(result.monthlyCostClp).toBe(72_150); // 78 × 925
    expect(result.seatsBySku['1010020028']).toBe(2);
  });

  it('licensing API falla → fallback usa user count × standard price', async () => {
    const adminClient: WorkspaceAdminClient = {
      listUsers: vi.fn(async () => ({ activeUsers: 10, suspendedUsers: 0 })),
      listLicenseAssignments: vi.fn(async () => {
        throw new Error('licensing scope not granted');
      }),
    };
    const svc = build(adminClient);
    const result = await svc.getUsageSnapshot();
    expect(result.available).toBe(true);
    expect(result.monthlyCostUsd).toBe(120); // 10 × 12 (standard)
    expect(fakeLogger.warn).toHaveBeenCalled();
  });

  it('SKU desconocida → fallback a standard price', async () => {
    const adminClient: WorkspaceAdminClient = {
      listUsers: vi.fn(async () => ({ activeUsers: 1, suspendedUsers: 0 })),
      listLicenseAssignments: vi.fn(async () => [{ skuId: 'unknown-sku' }]),
    };
    const svc = build(adminClient);
    const result = await svc.getUsageSnapshot();
    expect(result.monthlyCostUsd).toBe(12); // standard
  });

  it('listUsers falla → reporta unavailable con reason del error', async () => {
    const adminClient: WorkspaceAdminClient = {
      listUsers: vi.fn(async () => {
        throw new Error('admin scope missing');
      }),
      listLicenseAssignments: vi.fn(async () => []),
    };
    const svc = build(adminClient);
    const result = await svc.getUsageSnapshot();
    expect(result.available).toBe(false);
    expect(result.reason).toContain('admin scope missing');
  });
});
