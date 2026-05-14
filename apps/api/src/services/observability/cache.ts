import type { Logger } from '@booster-ai/logger';
import Redis from 'ioredis';

/**
 * Wrapper Redis con TTL para cachear queries caras del Observability
 * Dashboard (BigQuery $/query, Cloud Monitoring quota qpm, Twilio rate
 * limits, Workspace SDK rate limits).
 *
 * Diseño:
 * - Una sola instancia compartida por proceso. Reutiliza el Redis principal
 *   (variables REDIS_HOST/PORT/PASSWORD/TLS del config).
 * - Key prefix `obs:` para no colisionar con otros usos (chat realtime,
 *   conversation store, rate-limit counters).
 * - Valores serializados como JSON. TTL en segundos.
 * - Fallthrough: si Redis cae o el value es corrupto, llama al fetcher
 *   directo y loggea WARN. NO crashea el endpoint.
 *
 * Patrón de uso:
 * ```typescript
 * const data = await cache.getOrFetch(
 *   'costs:overview',
 *   300,  // 5 min TTL
 *   () => fetchCostsFromBigQuery(...)
 * );
 * ```
 */

const KEY_PREFIX = 'obs:';

export interface ObservabilityCacheOpts {
  host: string;
  port: number;
  password?: string | undefined;
  tls?: boolean | undefined;
  logger: Logger;
}

export class ObservabilityCache {
  private readonly redis: Redis;
  private readonly logger: Logger;

  constructor(opts: ObservabilityCacheOpts) {
    this.logger = opts.logger;
    this.redis = new Redis({
      host: opts.host,
      port: opts.port,
      ...(opts.password ? { password: opts.password } : {}),
      ...(opts.tls ? { tls: {} } : {}),
      // No reintentos infinitos — si Redis cae, el cache "miss" se vuelve
      // un fetch directo y seguimos. NO bloquear el endpoint.
      maxRetriesPerRequest: 2,
      // Conectar lazily al primer get/set; evita crashear el startup si
      // Redis está temporariamente unavailable.
      lazyConnect: true,
    });

    this.redis.on('error', (err) => {
      // No spam: 1 log por minuto.
      this.logger.warn({ err: err.message }, 'observability cache: Redis error');
    });
  }

  /**
   * Get-or-fetch pattern. Si el value está cacheado y no expiró,
   * retorna. Si no, llama al fetcher y cachea por TTL segundos.
   *
   * @param key key sin prefix (se agrega `obs:` internamente).
   * @param ttlSeconds tiempo de vida en cache.
   * @param fetcher función async que produce el valor si miss.
   */
  async getOrFetch<T>(key: string, ttlSeconds: number, fetcher: () => Promise<T>): Promise<T> {
    const fullKey = `${KEY_PREFIX}${key}`;
    try {
      const cached = await this.redis.get(fullKey);
      if (cached !== null) {
        try {
          return JSON.parse(cached) as T;
        } catch (err) {
          this.logger.warn(
            { key, err: err instanceof Error ? err.message : String(err) },
            'observability cache: invalid JSON, refetching',
          );
        }
      }
    } catch (err) {
      this.logger.warn(
        { key, err: err instanceof Error ? err.message : String(err) },
        'observability cache: Redis get failed, fetching direct',
      );
    }

    // Miss o error → fetch + intent de cachear (no bloquea el response)
    const value = await fetcher();
    // Fire-and-forget set; no esperamos el ACK del Redis.
    this.redis.set(fullKey, JSON.stringify(value), 'EX', ttlSeconds).catch((err) => {
      this.logger.warn(
        { key, err: err instanceof Error ? err.message : String(err) },
        'observability cache: Redis set failed (value still returned)',
      );
    });
    return value;
  }

  /**
   * Invalida una key (forzar fresh fetch en el próximo getOrFetch).
   * Útil para tests o admin endpoint de "reset cache".
   */
  async invalidate(key: string): Promise<void> {
    const fullKey = `${KEY_PREFIX}${key}`;
    try {
      await this.redis.del(fullKey);
    } catch (err) {
      this.logger.warn(
        { key, err: err instanceof Error ? err.message : String(err) },
        'observability cache: invalidate failed (non-fatal)',
      );
    }
  }

  /**
   * Cierra la conexión Redis. Solo en shutdown del proceso.
   */
  async close(): Promise<void> {
    await this.redis.quit();
  }
}
