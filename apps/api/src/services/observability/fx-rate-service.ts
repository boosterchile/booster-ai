import type { Logger } from '@booster-ai/logger';
import type { ObservabilityCache } from './cache.js';

/**
 * Cliente para tipo de cambio CLP/USD via mindicador.cl — API pública
 * chilena del Banco Central. Devuelve el "dólar observado" oficial
 * del día.
 *
 * Endpoint: https://mindicador.cl/api/dolar
 *
 * Respuesta esperada:
 * ```json
 * {
 *   "version": "...",
 *   "autor": "...",
 *   "codigo": "dolar",
 *   "nombre": "Dólar observado",
 *   "unidad_medida": "Pesos",
 *   "fecha": "...",
 *   "serie": [
 *     { "fecha": "2026-05-13T00:00:00.000Z", "valor": 925.34 },
 *     ...
 *   ]
 * }
 * ```
 *
 * Estrategia:
 * - Cache 1h (Banco Central actualiza 1 vez/día).
 * - Cache 24h del "último valor exitoso" como fallback si mindicador.cl
 *   está caído.
 * - Fallback hardcoded a 940 si nunca pudimos obtener un valor.
 */

const MINDICADOR_URL = 'https://mindicador.cl/api/dolar';
const CACHE_KEY = 'fx:clp-usd';
const FALLBACK_CACHE_KEY = 'fx:clp-usd:fallback';
const CACHE_TTL_SECONDS = 3600; // 1h fresh
const FALLBACK_TTL_SECONDS = 86400; // 24h stale-ok
const HARDCODED_FALLBACK_CLP_PER_USD = 940;
const FETCH_TIMEOUT_MS = 5000;

export interface FxRate {
  /** CLP por 1 USD. */
  clpPerUsd: number;
  /** ISO timestamp del fix oficial. */
  observedAt: string;
  /** Fuente: 'mindicador' | 'cache-fallback' | 'hardcoded' */
  source: 'mindicador' | 'cache-fallback' | 'hardcoded';
}

export interface FxRateServiceOpts {
  cache: ObservabilityCache;
  logger: Logger;
  /** Inyectable para tests. Default: global fetch. */
  fetchImpl?: typeof fetch;
}

export class FxRateService {
  private readonly cache: ObservabilityCache;
  private readonly logger: Logger;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: FxRateServiceOpts) {
    this.cache = opts.cache;
    this.logger = opts.logger;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /**
   * Obtiene el tipo de cambio CLP/USD vigente. Cache 1h en fresh,
   * 24h en fallback, 940 hardcoded como último recurso.
   */
  async getCurrentRate(): Promise<FxRate> {
    // Fast path: cache fresh
    return this.cache.getOrFetch<FxRate>(CACHE_KEY, CACHE_TTL_SECONDS, async () => {
      try {
        const rate = await this.fetchFromMindicador();
        // Persistir también en el fallback cache (24h) para que si
        // mindicador.cl cae mañana, podamos servir el valor de hoy.
        await this.cache.invalidate(FALLBACK_CACHE_KEY);
        await this.cache.getOrFetch(FALLBACK_CACHE_KEY, FALLBACK_TTL_SECONDS, async () => rate);
        return rate;
      } catch (err) {
        this.logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'fx-rate: mindicador.cl unavailable, trying fallback cache',
        );

        // Intentar el fallback cache (último valor exitoso, hasta 24h)
        try {
          const fallback = await this.cache.getOrFetch<FxRate | null>(
            FALLBACK_CACHE_KEY,
            FALLBACK_TTL_SECONDS,
            async () => null,
          );
          if (fallback) {
            return { ...fallback, source: 'cache-fallback' as const };
          }
        } catch (innerErr) {
          this.logger.warn(
            { err: innerErr instanceof Error ? innerErr.message : String(innerErr) },
            'fx-rate: fallback cache also failed',
          );
        }

        // Último recurso: hardcoded
        return {
          clpPerUsd: HARDCODED_FALLBACK_CLP_PER_USD,
          observedAt: new Date().toISOString(),
          source: 'hardcoded',
        };
      }
    });
  }

  /**
   * Convierte un monto USD a CLP usando el tipo actual.
   * Conveniencia para el resto del código.
   */
  async usdToClp(amountUsd: number): Promise<number> {
    const rate = await this.getCurrentRate();
    return Math.round(amountUsd * rate.clpPerUsd);
  }

  private async fetchFromMindicador(): Promise<FxRate> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await this.fetchImpl(MINDICADOR_URL, {
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`mindicador.cl returned ${response.status}`);
      }
      const json = (await response.json()) as {
        serie?: Array<{ fecha?: string; valor?: number }>;
      };
      const latest = json.serie?.[0];
      if (!latest || typeof latest.valor !== 'number' || latest.valor <= 0) {
        throw new Error('mindicador.cl: malformed response (no serie[0].valor)');
      }
      return {
        clpPerUsd: latest.valor,
        observedAt: latest.fecha ?? new Date().toISOString(),
        source: 'mindicador',
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
