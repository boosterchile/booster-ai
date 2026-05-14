import type { Logger } from '@booster-ai/logger';
import { GoogleAuth } from 'google-auth-library';
import type { ObservabilityCache } from './cache.js';
import type { FxRateService } from './fx-rate-service.js';

/**
 * Cliente BigQuery billing_export para el Observability Dashboard.
 *
 * No usa `@google-cloud/bigquery` (10MB+) — invoca el endpoint REST
 * `bigquery.googleapis.com/bigquery/v2/projects/.../queries` directo
 * con `fetch` + ADC, igual que `routes-api.ts`.
 *
 * Costos se reportan en la moneda nativa del billing account (CLP en
 * Booster). Si la columna `currency` es USD, convierte vía FxRateService.
 *
 * Caching: 5 min TTL — billing_export se actualiza ~cada hora.
 *
 * Source schema: gcp_billing_export_v1 (standard schema):
 *   - service.description (string)
 *   - sku.description (string)
 *   - project.id, project.name
 *   - cost (numeric), currency (string)
 *   - credits ARRAY<STRUCT<amount FLOAT64>>
 *   - usage_start_time, usage_end_time (timestamp)
 */

const BQ_BASE_URL = 'https://bigquery.googleapis.com/bigquery/v2';
const CACHE_TTL_OVERVIEW = 300; // 5 min
const CACHE_TTL_BY_SERVICE = 300;
const CACHE_TTL_TREND = 600; // 10 min — más estable
const CACHE_TTL_BY_PROJECT = 300;
const QUERY_TIMEOUT_MS = 30_000;

export interface CostsOverview {
  /** Costo acumulado del mes en curso (1-current day), en CLP. */
  costClpMonthToDate: number;
  /** Costo del mes anterior completo, en CLP. */
  costClpPreviousMonth: number;
  /** Δ% vs mes anterior (mismo periodo). null si no hay base. */
  deltaPercentVsPreviousMonth: number | null;
  /** Última actualización del billing_export (UTC). */
  lastBillingExportAt: string | null;
}

export interface CostsByService {
  /** Nombre del servicio GCP (e.g., "Cloud Run", "Cloud SQL"). */
  service: string;
  /** Costo total del rango, en CLP. */
  costClp: number;
  /** % del costo total del rango. */
  percentOfTotal: number;
}

export interface CostsTrendPoint {
  /** ISO date YYYY-MM-DD. */
  date: string;
  /** Costo del día en CLP (suma de todos los servicios + proyectos). */
  costClp: number;
}

export interface CostsByProject {
  projectId: string;
  projectName: string | null;
  costClp: number;
  percentOfTotal: number;
}

export interface TopSku {
  service: string;
  sku: string;
  costClp: number;
}

export interface CostsServiceOpts {
  cache: ObservabilityCache;
  fxRateService: FxRateService;
  logger: Logger;
  /** Tabla fully-qualified: `project.dataset.gcp_billing_export_v1_XXXXX`. */
  billingExportTable: string;
  /** GCP project que ejecuta los queries (puede ser distinto del billing). */
  queryProjectId: string;
  /** Inyectable para tests. Default: global fetch. */
  fetchImpl?: typeof fetch;
  /** Inyectable para tests. Default: GoogleAuth ADC. */
  getAccessToken?: () => Promise<string>;
}

interface BqQueryResponse {
  jobComplete?: boolean;
  rows?: Array<{ f: Array<{ v: string | null }> }>;
  schema?: { fields: Array<{ name: string }> };
  errors?: Array<{ message: string }>;
}

export class CostsService {
  private readonly cache: ObservabilityCache;
  private readonly fxRateService: FxRateService;
  private readonly logger: Logger;
  private readonly billingExportTable: string;
  private readonly queryProjectId: string;
  private readonly fetchImpl: typeof fetch;
  private readonly getAccessToken: () => Promise<string>;

  constructor(opts: CostsServiceOpts) {
    this.cache = opts.cache;
    this.fxRateService = opts.fxRateService;
    this.logger = opts.logger;
    this.billingExportTable = opts.billingExportTable;
    this.queryProjectId = opts.queryProjectId;
    this.fetchImpl = opts.fetchImpl ?? fetch;

    if (opts.getAccessToken) {
      this.getAccessToken = opts.getAccessToken;
    } else {
      const auth = new GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/bigquery.readonly'],
      });
      this.getAccessToken = async () => {
        const client = await auth.getClient();
        const token = await client.getAccessToken();
        if (!token.token) {
          throw new Error('BigQuery: failed to obtain access token from ADC');
        }
        return token.token;
      };
    }
  }

  async getOverview(): Promise<CostsOverview> {
    return this.cache.getOrFetch('costs:overview', CACHE_TTL_OVERVIEW, async () => {
      const sql = `
        WITH base AS (
          SELECT
            DATE_TRUNC(DATE(usage_start_time, 'America/Santiago'), MONTH) AS month,
            SUM(cost + IFNULL((SELECT SUM(amount) FROM UNNEST(credits)), 0)) AS net_cost,
            ANY_VALUE(currency) AS currency,
            MAX(export_time) AS last_export
          FROM \`${this.billingExportTable}\`
          WHERE DATE(usage_start_time, 'America/Santiago')
            >= DATE_TRUNC(CURRENT_DATE('America/Santiago'), MONTH) - INTERVAL 1 MONTH
          GROUP BY month
        )
        SELECT
          month,
          net_cost,
          currency,
          last_export
        FROM base
        ORDER BY month DESC
      `;
      const { rows, currency } = await this.runQuery(sql);
      const thisMonth = Number.parseFloat(rows[0]?.[1] ?? '0');
      const previousMonth = Number.parseFloat(rows[1]?.[1] ?? '0');
      const lastExport = rows[0]?.[3] ?? null;

      const thisMonthClp = await this.toClp(thisMonth, currency);
      const previousMonthClp = await this.toClp(previousMonth, currency);
      const delta =
        previousMonthClp > 0 ? ((thisMonthClp - previousMonthClp) / previousMonthClp) * 100 : null;

      return {
        costClpMonthToDate: Math.round(thisMonthClp),
        costClpPreviousMonth: Math.round(previousMonthClp),
        deltaPercentVsPreviousMonth: delta !== null ? Math.round(delta * 10) / 10 : null,
        lastBillingExportAt: lastExport,
      };
    });
  }

  async getByService(rangeDays: number): Promise<CostsByService[]> {
    const clamped = this.clampRangeDays(rangeDays);
    return this.cache.getOrFetch(`costs:by-service:${clamped}`, CACHE_TTL_BY_SERVICE, async () => {
      const sql = `
          SELECT
            service.description AS service,
            SUM(cost + IFNULL((SELECT SUM(amount) FROM UNNEST(credits)), 0)) AS net_cost,
            ANY_VALUE(currency) AS currency
          FROM \`${this.billingExportTable}\`
          WHERE DATE(usage_start_time, 'America/Santiago')
            >= DATE_SUB(CURRENT_DATE('America/Santiago'), INTERVAL ${clamped} DAY)
          GROUP BY service
          HAVING net_cost > 0
          ORDER BY net_cost DESC
          LIMIT 20
        `;
      const { rows, currency } = await this.runQuery(sql);
      const items = await Promise.all(
        rows.map(async (r) => ({
          service: r[0] ?? 'Unknown',
          costClp: Math.round(await this.toClp(Number.parseFloat(r[1] ?? '0'), currency)),
        })),
      );
      const total = items.reduce((s, i) => s + i.costClp, 0);
      return items.map((i) => ({
        ...i,
        percentOfTotal: total > 0 ? Math.round((i.costClp / total) * 1000) / 10 : 0,
      }));
    });
  }

  async getTrend(rangeDays: number): Promise<CostsTrendPoint[]> {
    const clamped = this.clampRangeDays(rangeDays);
    return this.cache.getOrFetch(`costs:trend:${clamped}`, CACHE_TTL_TREND, async () => {
      const sql = `
        SELECT
          FORMAT_DATE('%Y-%m-%d', DATE(usage_start_time, 'America/Santiago')) AS day,
          SUM(cost + IFNULL((SELECT SUM(amount) FROM UNNEST(credits)), 0)) AS net_cost,
          ANY_VALUE(currency) AS currency
        FROM \`${this.billingExportTable}\`
        WHERE DATE(usage_start_time, 'America/Santiago')
          >= DATE_SUB(CURRENT_DATE('America/Santiago'), INTERVAL ${clamped} DAY)
        GROUP BY day
        ORDER BY day ASC
      `;
      const { rows, currency } = await this.runQuery(sql);
      return Promise.all(
        rows.map(async (r) => ({
          date: r[0] ?? '',
          costClp: Math.round(await this.toClp(Number.parseFloat(r[1] ?? '0'), currency)),
        })),
      );
    });
  }

  async getByProject(rangeDays: number): Promise<CostsByProject[]> {
    const clamped = this.clampRangeDays(rangeDays);
    return this.cache.getOrFetch(`costs:by-project:${clamped}`, CACHE_TTL_BY_PROJECT, async () => {
      const sql = `
          SELECT
            project.id AS project_id,
            ANY_VALUE(project.name) AS project_name,
            SUM(cost + IFNULL((SELECT SUM(amount) FROM UNNEST(credits)), 0)) AS net_cost,
            ANY_VALUE(currency) AS currency
          FROM \`${this.billingExportTable}\`
          WHERE DATE(usage_start_time, 'America/Santiago')
            >= DATE_SUB(CURRENT_DATE('America/Santiago'), INTERVAL ${clamped} DAY)
            AND project.id IS NOT NULL
          GROUP BY project_id
          HAVING net_cost > 0
          ORDER BY net_cost DESC
        `;
      const { rows, currency } = await this.runQuery(sql);
      const items = await Promise.all(
        rows.map(async (r) => ({
          projectId: r[0] ?? 'unknown',
          projectName: r[1] ?? null,
          costClp: Math.round(await this.toClp(Number.parseFloat(r[2] ?? '0'), currency)),
        })),
      );
      const total = items.reduce((s, i) => s + i.costClp, 0);
      return items.map((i) => ({
        ...i,
        percentOfTotal: total > 0 ? Math.round((i.costClp / total) * 1000) / 10 : 0,
      }));
    });
  }

  async getTopSkus(limit = 10): Promise<TopSku[]> {
    const clampedLimit = Math.max(1, Math.min(50, Math.round(limit)));
    return this.cache.getOrFetch(`costs:top-skus:${clampedLimit}`, CACHE_TTL_OVERVIEW, async () => {
      const sql = `
        SELECT
          service.description AS service,
          sku.description AS sku,
          SUM(cost + IFNULL((SELECT SUM(amount) FROM UNNEST(credits)), 0)) AS net_cost,
          ANY_VALUE(currency) AS currency
        FROM \`${this.billingExportTable}\`
        WHERE DATE(usage_start_time, 'America/Santiago')
          >= DATE_TRUNC(CURRENT_DATE('America/Santiago'), MONTH)
        GROUP BY service, sku
        HAVING net_cost > 0
        ORDER BY net_cost DESC
        LIMIT ${clampedLimit}
      `;
      const { rows, currency } = await this.runQuery(sql);
      return Promise.all(
        rows.map(async (r) => ({
          service: r[0] ?? 'Unknown',
          sku: r[1] ?? 'Unknown',
          costClp: Math.round(await this.toClp(Number.parseFloat(r[2] ?? '0'), currency)),
        })),
      );
    });
  }

  private clampRangeDays(rangeDays: number): number {
    return Math.max(1, Math.min(90, Math.round(rangeDays)));
  }

  private async toClp(amount: number, currency: string | null): Promise<number> {
    if (!Number.isFinite(amount)) {
      return 0;
    }
    if (!currency || currency === 'CLP') {
      return amount;
    }
    if (currency === 'USD') {
      return this.fxRateService.usdToClp(amount);
    }
    this.logger.warn(
      { currency, amount },
      'costs-service: unsupported currency, returning raw value',
    );
    return amount;
  }

  private async runQuery(sql: string): Promise<{
    rows: Array<Array<string | null>>;
    currency: string | null;
  }> {
    const token = await this.getAccessToken();
    const url = `${BQ_BASE_URL}/projects/${this.queryProjectId}/queries`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS);

    try {
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: sql,
          useLegacySql: false,
          timeoutMs: QUERY_TIMEOUT_MS,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`BigQuery query failed: ${response.status} ${body.slice(0, 200)}`);
      }

      const json = (await response.json()) as BqQueryResponse;
      if (json.errors?.length) {
        throw new Error(`BigQuery error: ${json.errors[0]?.message ?? 'unknown'}`);
      }
      if (json.jobComplete === false) {
        throw new Error('BigQuery query did not complete within timeout');
      }

      const fields = json.schema?.fields ?? [];
      const currencyIdx = fields.findIndex((f) => f.name === 'currency');
      const rows = (json.rows ?? []).map((row) => row.f.map((cell) => cell.v));
      const currency = currencyIdx >= 0 ? (rows[0]?.[currencyIdx] ?? null) : null;

      return { rows, currency };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
