import type { Logger } from '@booster-ai/logger';
import type { ObservabilityCache } from './cache.js';
import type { FxRateService } from './fx-rate-service.js';

/**
 * Cliente Twilio Usage Records + Account Balance para el dashboard.
 *
 * Twilio expone usage usage por categoría (sms, wa_msg_in, wa_msg_out)
 * y un endpoint de balance. Auth = HTTP Basic con account SID + auth token.
 *
 * Cache 5min — el balance no cambia más rápido y los usage records
 * agregan por día.
 */

const TWILIO_BASE_URL = 'https://api.twilio.com';
const CACHE_TTL_SECONDS = 300;
const FETCH_TIMEOUT_MS = 10_000;

export interface TwilioUsageServiceOpts {
  cache: ObservabilityCache;
  fxRateService: FxRateService;
  logger: Logger;
  accountSid: string;
  authToken: string;
  /** Inyectable para tests. */
  fetchImpl?: typeof fetch;
}

export interface TwilioBalance {
  balanceUsd: number;
  balanceClp: number;
  currency: string;
}

export interface TwilioUsageItem {
  category: string;
  description: string;
  usage: number;
  usageUnit: string;
  priceUsd: number;
  priceClp: number;
}

interface BalanceResponse {
  balance?: string;
  currency?: string;
}

interface UsageRecordsResponse {
  usage_records?: Array<{
    category?: string;
    description?: string;
    usage?: string;
    usage_unit?: string;
    price?: string;
    price_unit?: string;
  }>;
}

export class TwilioUsageService {
  private readonly cache: ObservabilityCache;
  private readonly fxRateService: FxRateService;
  private readonly logger: Logger;
  private readonly accountSid: string;
  private readonly authHeader: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: TwilioUsageServiceOpts) {
    this.cache = opts.cache;
    this.fxRateService = opts.fxRateService;
    this.logger = opts.logger;
    this.accountSid = opts.accountSid;
    this.authHeader = `Basic ${Buffer.from(`${opts.accountSid}:${opts.authToken}`).toString('base64')}`;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async getBalance(): Promise<TwilioBalance> {
    return this.cache.getOrFetch('twilio:balance', CACHE_TTL_SECONDS, async () => {
      const url = `${TWILIO_BASE_URL}/2010-04-01/Accounts/${this.accountSid}/Balance.json`;
      const json = (await this.fetchJson(url)) as BalanceResponse;
      const balanceUsd = Number.parseFloat(json.balance ?? '0');
      const balanceClp = await this.fxRateService.usdToClp(balanceUsd);
      return {
        balanceUsd,
        balanceClp,
        currency: json.currency ?? 'USD',
      };
    });
  }

  /**
   * Usage records del mes actual, top 10 categorías por costo.
   */
  async getMonthToDateUsage(): Promise<TwilioUsageItem[]> {
    return this.cache.getOrFetch('twilio:usage:mtd', CACHE_TTL_SECONDS, async () => {
      const url = `${TWILIO_BASE_URL}/2010-04-01/Accounts/${this.accountSid}/Usage/Records/ThisMonth.json?PageSize=100`;
      const json = (await this.fetchJson(url)) as UsageRecordsResponse;
      const records = json.usage_records ?? [];

      const items: TwilioUsageItem[] = [];
      for (const r of records) {
        const priceUsd = Number.parseFloat(r.price ?? '0');
        if (priceUsd <= 0) {
          continue;
        }
        items.push({
          category: r.category ?? 'unknown',
          description: r.description ?? '',
          usage: Number.parseFloat(r.usage ?? '0'),
          usageUnit: r.usage_unit ?? '',
          priceUsd,
          priceClp: Math.round(await this.fxRateService.usdToClp(priceUsd)),
        });
      }
      items.sort((a, b) => b.priceUsd - a.priceUsd);
      return items.slice(0, 10);
    });
  }

  private async fetchJson(url: string): Promise<unknown> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(url, {
        headers: { Authorization: this.authHeader },
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.text();
        this.logger.warn(
          { status: response.status, body: body.slice(0, 200) },
          'twilio: API call failed',
        );
        throw new Error(`Twilio API returned ${response.status}`);
      }
      return await response.json();
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
