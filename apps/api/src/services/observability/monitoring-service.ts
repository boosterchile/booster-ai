import type { Logger } from '@booster-ai/logger';
import { GoogleAuth } from 'google-auth-library';
import type { ObservabilityCache } from './cache.js';

/**
 * Cliente Cloud Monitoring API v3 para métricas operativas (uptime,
 * latencia, CPU, RAM, RPS) del Observability Dashboard.
 *
 * No usa `@google-cloud/monitoring` (peso) — invoca el endpoint REST
 * `monitoring.googleapis.com/v3/projects/.../timeSeries` con fetch + ADC.
 *
 * Cache 60s TTL — métricas tienen resolución por minuto en Cloud
 * Monitoring; pedir más seguido no aporta.
 */

const MONITORING_BASE_URL = 'https://monitoring.googleapis.com/v3';
const CACHE_TTL_SECONDS = 60;
const FETCH_TIMEOUT_MS = 15_000;

export interface MonitoringServiceOpts {
  cache: ObservabilityCache;
  logger: Logger;
  /** Project que tiene los recursos monitoreados (Cloud Run, Cloud SQL). */
  projectId: string;
  /** Inyectable para tests. */
  fetchImpl?: typeof fetch;
  /** Inyectable para tests. */
  getAccessToken?: () => Promise<string>;
}

export interface TimeSeriesPoint {
  /** ISO timestamp UTC (inicio del intervalo de muestreo). */
  timestamp: string;
  /** Valor numérico. */
  value: number;
}

export interface UptimeSnapshot {
  /** % de checks exitosos en la ventana (0-100). */
  uptimePercent: number;
  /** Cantidad de uptime checks configurados. */
  totalChecks: number;
  /** Última muestra (UTC). */
  lastSampleAt: string | null;
}

export interface CloudRunMetrics {
  /** Latencia p95 (ms). */
  latencyP95Ms: number | null;
  /** CPU utilization promedio (0-1). */
  cpuUtilization: number | null;
  /** RAM utilization promedio (0-1). */
  ramUtilization: number | null;
  /** Requests por segundo (promedio en ventana). */
  rps: number | null;
}

export interface CloudSqlMetrics {
  cpuUtilization: number | null;
  ramUtilization: number | null;
  diskUtilization: number | null;
  connectionsUsedRatio: number | null;
}

interface TimeSeriesResponse {
  timeSeries?: Array<{
    metric?: { type?: string; labels?: Record<string, string> };
    resource?: { labels?: Record<string, string> };
    points?: Array<{
      interval?: { startTime?: string; endTime?: string };
      value?: {
        doubleValue?: number;
        int64Value?: string;
        boolValue?: boolean;
        distributionValue?: {
          mean?: number;
          count?: string;
          bucketCounts?: string[];
          bucketOptions?: unknown;
        };
      };
    }>;
  }>;
  error?: { message?: string };
}

export class MonitoringService {
  private readonly cache: ObservabilityCache;
  private readonly logger: Logger;
  private readonly projectId: string;
  private readonly fetchImpl: typeof fetch;
  private readonly getAccessToken: () => Promise<string>;

  constructor(opts: MonitoringServiceOpts) {
    this.cache = opts.cache;
    this.logger = opts.logger;
    this.projectId = opts.projectId;
    this.fetchImpl = opts.fetchImpl ?? fetch;

    if (opts.getAccessToken) {
      this.getAccessToken = opts.getAccessToken;
    } else {
      const auth = new GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/monitoring.read'],
      });
      this.getAccessToken = async () => {
        const client = await auth.getClient();
        const token = await client.getAccessToken();
        if (!token.token) {
          throw new Error('Monitoring: failed to obtain access token from ADC');
        }
        return token.token;
      };
    }
  }

  /** Uptime checks: % éxito en últimos 60 minutos. */
  async getUptimeSnapshot(): Promise<UptimeSnapshot> {
    return this.cache.getOrFetch('monitoring:uptime', CACHE_TTL_SECONDS, async () => {
      const { startTime, endTime } = this.lastWindow(60 * 60);
      const series = await this.fetchTimeSeries({
        filter: 'metric.type = "monitoring.googleapis.com/uptime_check/check_passed"',
        startTime,
        endTime,
        aggregationAlignmentPeriod: '60s',
        aggregationPerSeriesAligner: 'ALIGN_FRACTION_TRUE',
      });

      if (series.length === 0) {
        return { uptimePercent: 100, totalChecks: 0, lastSampleAt: null };
      }

      const allPoints = series.flatMap((s) => s.points ?? []);
      const values = allPoints
        .map((p) => p.value?.doubleValue ?? p.value?.boolValue)
        .filter((v): v is number | boolean => v !== undefined)
        .map((v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v));
      const avg = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 1;
      const lastSampleAt =
        allPoints[0]?.interval?.endTime ?? allPoints[0]?.interval?.startTime ?? null;

      return {
        uptimePercent: Math.round(avg * 1000) / 10,
        totalChecks: series.length,
        lastSampleAt,
      };
    });
  }

  /** Métricas Cloud Run agregadas a través de todos los servicios del proyecto. */
  async getCloudRunMetrics(): Promise<CloudRunMetrics> {
    return this.cache.getOrFetch('monitoring:cloud-run', CACHE_TTL_SECONDS, async () => {
      const { startTime, endTime } = this.lastWindow(15 * 60);

      const [latencySeries, cpuSeries, ramSeries, requestSeries] = await Promise.all([
        this.fetchTimeSeries({
          filter: 'metric.type = "run.googleapis.com/request_latencies"',
          startTime,
          endTime,
          aggregationAlignmentPeriod: '60s',
          aggregationPerSeriesAligner: 'ALIGN_PERCENTILE_95',
          aggregationCrossSeriesReducer: 'REDUCE_MEAN',
        }),
        this.fetchTimeSeries({
          filter: 'metric.type = "run.googleapis.com/container/cpu/utilizations"',
          startTime,
          endTime,
          aggregationAlignmentPeriod: '60s',
          aggregationPerSeriesAligner: 'ALIGN_MEAN',
          aggregationCrossSeriesReducer: 'REDUCE_MEAN',
        }),
        this.fetchTimeSeries({
          filter: 'metric.type = "run.googleapis.com/container/memory/utilizations"',
          startTime,
          endTime,
          aggregationAlignmentPeriod: '60s',
          aggregationPerSeriesAligner: 'ALIGN_MEAN',
          aggregationCrossSeriesReducer: 'REDUCE_MEAN',
        }),
        this.fetchTimeSeries({
          filter: 'metric.type = "run.googleapis.com/request_count"',
          startTime,
          endTime,
          aggregationAlignmentPeriod: '60s',
          aggregationPerSeriesAligner: 'ALIGN_RATE',
          aggregationCrossSeriesReducer: 'REDUCE_SUM',
        }),
      ]);

      return {
        latencyP95Ms: this.averageDistMean(latencySeries),
        cpuUtilization: this.averageDouble(cpuSeries),
        ramUtilization: this.averageDouble(ramSeries),
        rps: this.averageDouble(requestSeries),
      };
    });
  }

  /** Métricas Cloud SQL (instance-wide). */
  async getCloudSqlMetrics(): Promise<CloudSqlMetrics> {
    return this.cache.getOrFetch('monitoring:cloud-sql', CACHE_TTL_SECONDS, async () => {
      const { startTime, endTime } = this.lastWindow(15 * 60);
      const [cpu, mem, disk, conns] = await Promise.all([
        this.fetchTimeSeries({
          filter: 'metric.type = "cloudsql.googleapis.com/database/cpu/utilization"',
          startTime,
          endTime,
          aggregationAlignmentPeriod: '60s',
          aggregationPerSeriesAligner: 'ALIGN_MEAN',
          aggregationCrossSeriesReducer: 'REDUCE_MEAN',
        }),
        this.fetchTimeSeries({
          filter: 'metric.type = "cloudsql.googleapis.com/database/memory/utilization"',
          startTime,
          endTime,
          aggregationAlignmentPeriod: '60s',
          aggregationPerSeriesAligner: 'ALIGN_MEAN',
          aggregationCrossSeriesReducer: 'REDUCE_MEAN',
        }),
        this.fetchTimeSeries({
          filter: 'metric.type = "cloudsql.googleapis.com/database/disk/utilization"',
          startTime,
          endTime,
          aggregationAlignmentPeriod: '60s',
          aggregationPerSeriesAligner: 'ALIGN_MEAN',
          aggregationCrossSeriesReducer: 'REDUCE_MEAN',
        }),
        this.fetchTimeSeries({
          filter: 'metric.type = "cloudsql.googleapis.com/database/postgresql/num_backends"',
          startTime,
          endTime,
          aggregationAlignmentPeriod: '60s',
          aggregationPerSeriesAligner: 'ALIGN_MEAN',
          aggregationCrossSeriesReducer: 'REDUCE_MEAN',
        }),
      ]);

      const connsUsed = this.averageDouble(conns);
      return {
        cpuUtilization: this.averageDouble(cpu),
        ramUtilization: this.averageDouble(mem),
        diskUtilization: this.averageDouble(disk),
        // Aproximación: cuenta de backends / 100 como signal. UI lo trata
        // como ratio 0-1 sin saturarse.
        connectionsUsedRatio: connsUsed !== null ? Math.min(1, connsUsed / 100) : null,
      };
    });
  }

  private async fetchTimeSeries(params: {
    filter: string;
    startTime: string;
    endTime: string;
    aggregationAlignmentPeriod: string;
    aggregationPerSeriesAligner: string;
    aggregationCrossSeriesReducer?: string;
  }): Promise<NonNullable<TimeSeriesResponse['timeSeries']>> {
    const token = await this.getAccessToken();
    const qs = new URLSearchParams({
      filter: params.filter,
      'interval.startTime': params.startTime,
      'interval.endTime': params.endTime,
      'aggregation.alignmentPeriod': params.aggregationAlignmentPeriod,
      'aggregation.perSeriesAligner': params.aggregationPerSeriesAligner,
      view: 'FULL',
    });
    if (params.aggregationCrossSeriesReducer) {
      qs.set('aggregation.crossSeriesReducer', params.aggregationCrossSeriesReducer);
    }

    const url = `${MONITORING_BASE_URL}/projects/${this.projectId}/timeSeries?${qs.toString()}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await this.fetchImpl(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.text();
        this.logger.warn(
          { status: response.status, body: body.slice(0, 200) },
          'monitoring: timeSeries fetch failed',
        );
        return [];
      }
      const json = (await response.json()) as TimeSeriesResponse;
      return json.timeSeries ?? [];
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private lastWindow(seconds: number): { startTime: string; endTime: string } {
    const end = new Date();
    const start = new Date(end.getTime() - seconds * 1000);
    return { startTime: start.toISOString(), endTime: end.toISOString() };
  }

  private averageDouble(series: NonNullable<TimeSeriesResponse['timeSeries']>): number | null {
    const values = series.flatMap((s) =>
      (s.points ?? []).map((p) => p.value?.doubleValue).filter((v): v is number => v !== undefined),
    );
    if (values.length === 0) {
      return null;
    }
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  private averageDistMean(series: NonNullable<TimeSeriesResponse['timeSeries']>): number | null {
    const values = series.flatMap((s) =>
      (s.points ?? [])
        .map((p) => p.value?.distributionValue?.mean ?? p.value?.doubleValue)
        .filter((v): v is number => v !== undefined && Number.isFinite(v)),
    );
    if (values.length === 0) {
      return null;
    }
    return values.reduce((a, b) => a + b, 0) / values.length;
  }
}
