import type { Logger } from '@booster-ai/logger';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ObservabilityCache } from '../../../src/services/observability/cache.js';
import type { FxRateService } from '../../../src/services/observability/fx-rate-service.js';
import { TwilioUsageService } from '../../../src/services/observability/twilio-usage-service.js';

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

function build(fetchImpl: typeof fetch): TwilioUsageService {
  return new TwilioUsageService({
    cache: new InMemoryCacheStub() as unknown as ObservabilityCache,
    fxRateService: fakeFx,
    logger: fakeLogger,
    accountSid: 'ACtest123',
    authToken: 'auth-token-secret',
    fetchImpl,
  });
}

describe('TwilioUsageService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getBalance: USD balance + conversion CLP', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({ balance: '42.50', currency: 'USD' }),
    })) as unknown as typeof fetch;
    const svc = build(fetchImpl);
    const result = await svc.getBalance();
    expect(result.balanceUsd).toBe(42.5);
    expect(result.balanceClp).toBe(39_313); // 42.50 × 925 = 39312.5 → round
    expect(result.currency).toBe('USD');
  });

  it('getBalance: Basic auth header correcto', async () => {
    let capturedAuth = '';
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedAuth = (init?.headers as Record<string, string>)?.Authorization ?? '';
      return {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({ balance: '0', currency: 'USD' }),
      };
    }) as unknown as typeof fetch;
    const svc = build(fetchImpl);
    await svc.getBalance();
    const expected = `Basic ${Buffer.from('ACtest123:auth-token-secret').toString('base64')}`;
    expect(capturedAuth).toBe(expected);
  });

  it('getMonthToDateUsage: filtra price=0, ordena por priceUsd desc, top 10', async () => {
    const records = [
      { category: 'sms', description: 'SMS', usage: '500', usage_unit: 'messages', price: '10' },
      {
        category: 'wa_msg_in',
        description: 'WA in',
        usage: '1000',
        usage_unit: 'messages',
        price: '0',
      }, // filtrado
      {
        category: 'wa_msg_out',
        description: 'WA out',
        usage: '200',
        usage_unit: 'messages',
        price: '25.50',
      },
      {
        category: 'voice',
        description: 'Voice',
        usage: '60',
        usage_unit: 'minutes',
        price: '5.25',
      },
    ];
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({ usage_records: records }),
    })) as unknown as typeof fetch;
    const svc = build(fetchImpl);
    const result = await svc.getMonthToDateUsage();
    expect(result).toHaveLength(3); // wa_msg_in filtered out
    expect(result[0]?.category).toBe('wa_msg_out');
    expect(result[0]?.priceUsd).toBe(25.5);
    expect(result[2]?.category).toBe('voice');
  });

  it('getMonthToDateUsage: lista vacía si Twilio no devuelve registros', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({ usage_records: [] }),
    })) as unknown as typeof fetch;
    const svc = build(fetchImpl);
    const result = await svc.getMonthToDateUsage();
    expect(result).toEqual([]);
  });

  it('getBalance: API error → throw', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 401,
      text: async () => 'unauthorized',
      json: async () => ({}),
    })) as unknown as typeof fetch;
    const svc = build(fetchImpl);
    await expect(svc.getBalance()).rejects.toThrow(/401/);
    expect(fakeLogger.warn).toHaveBeenCalled();
  });
});
