import type { Logger } from '@booster-ai/logger';
import type { ObservabilityCache } from './cache.js';
import type { MonitoringService } from './monitoring-service.js';

/**
 * Compositor de salud técnica — combina uptime + métricas Cloud Run +
 * Cloud SQL en un semáforo único (🟢/🟡/🔴) por componente.
 *
 * Reglas:
 * - 🟢 healthy: uptime >= 99.5 AND CPU < 0.7 AND RAM < 0.8
 * - 🟡 degraded: uptime [98, 99.5) OR CPU [0.7, 0.85) OR RAM [0.8, 0.92)
 * - 🔴 critical: uptime < 98 OR CPU >= 0.85 OR RAM >= 0.92
 *
 * Si un componente no tiene data (Cloud Monitoring no devolvió series),
 * lo reporta como 'unknown' — la UI lo pinta gris.
 */

const CACHE_TTL_SECONDS = 60;

export type HealthLevel = 'healthy' | 'degraded' | 'critical' | 'unknown';

export interface ComponentHealth {
  name: string;
  level: HealthLevel;
  message: string;
}

export interface HealthSnapshot {
  /** Nivel agregado: peor componente. */
  overall: HealthLevel;
  components: ComponentHealth[];
  lastEvaluatedAt: string;
}

export interface HealthChecksServiceOpts {
  cache: ObservabilityCache;
  monitoringService: MonitoringService;
  logger: Logger;
}

export class HealthChecksService {
  private readonly cache: ObservabilityCache;
  private readonly monitoringService: MonitoringService;

  constructor(opts: HealthChecksServiceOpts) {
    this.cache = opts.cache;
    this.monitoringService = opts.monitoringService;
  }

  async getSnapshot(): Promise<HealthSnapshot> {
    return this.cache.getOrFetch('health:snapshot', CACHE_TTL_SECONDS, async () => {
      const [uptime, cloudRun, cloudSql] = await Promise.all([
        this.monitoringService.getUptimeSnapshot().catch(() => null),
        this.monitoringService.getCloudRunMetrics().catch(() => null),
        this.monitoringService.getCloudSqlMetrics().catch(() => null),
      ]);

      const components: ComponentHealth[] = [];

      if (uptime && uptime.totalChecks > 0) {
        components.push({
          name: 'uptime',
          level: this.uptimeLevel(uptime.uptimePercent),
          message: `${uptime.uptimePercent.toFixed(1)}% en últimos 60 min · ${uptime.totalChecks} checks`,
        });
      } else {
        components.push({
          name: 'uptime',
          level: 'unknown',
          message: 'No uptime checks configurados',
        });
      }

      if (cloudRun) {
        components.push({
          name: 'cloud-run',
          level: this.resourceLevel(cloudRun.cpuUtilization, cloudRun.ramUtilization),
          message: this.formatResource(cloudRun.cpuUtilization, cloudRun.ramUtilization),
        });
      } else {
        components.push({
          name: 'cloud-run',
          level: 'unknown',
          message: 'Sin datos de Cloud Monitoring',
        });
      }

      if (cloudSql) {
        components.push({
          name: 'cloud-sql',
          level: this.resourceLevel(cloudSql.cpuUtilization, cloudSql.ramUtilization),
          message: this.formatResource(cloudSql.cpuUtilization, cloudSql.ramUtilization),
        });
      } else {
        components.push({
          name: 'cloud-sql',
          level: 'unknown',
          message: 'Sin datos de Cloud Monitoring',
        });
      }

      return {
        overall: this.worst(components.map((c) => c.level)),
        components,
        lastEvaluatedAt: new Date().toISOString(),
      };
    });
  }

  private uptimeLevel(percent: number): HealthLevel {
    if (percent >= 99.5) {
      return 'healthy';
    }
    if (percent >= 98) {
      return 'degraded';
    }
    return 'critical';
  }

  private resourceLevel(cpu: number | null, ram: number | null): HealthLevel {
    if (cpu === null && ram === null) {
      return 'unknown';
    }
    const cpuLevel =
      cpu === null ? 'healthy' : cpu >= 0.85 ? 'critical' : cpu >= 0.7 ? 'degraded' : 'healthy';
    const ramLevel =
      ram === null ? 'healthy' : ram >= 0.92 ? 'critical' : ram >= 0.8 ? 'degraded' : 'healthy';
    return this.worst([cpuLevel, ramLevel]);
  }

  private formatResource(cpu: number | null, ram: number | null): string {
    const cpuStr = cpu === null ? 'n/a' : `${Math.round(cpu * 100)}%`;
    const ramStr = ram === null ? 'n/a' : `${Math.round(ram * 100)}%`;
    return `CPU ${cpuStr} · RAM ${ramStr}`;
  }

  private worst(levels: HealthLevel[]): HealthLevel {
    if (levels.includes('critical')) {
      return 'critical';
    }
    if (levels.includes('degraded')) {
      return 'degraded';
    }
    if (levels.every((l) => l === 'unknown')) {
      return 'unknown';
    }
    return 'healthy';
  }
}
