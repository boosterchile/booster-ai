import {
  type DteEmitter,
  DteNotConfiguredError,
  MockDteAdapter,
  SovosDteAdapter,
} from '@booster-ai/dte-provider';
import type { Logger } from '@booster-ai/logger';
import { config as appConfig } from '../config.js';

/**
 * ADR-024 — factory que devuelve el adapter activo según `DTE_PROVIDER`.
 *
 * Comportamiento por valor:
 *   - `'disabled'` → retorna `null`. El caller debe skipear silencioso
 *     con warn. Las liquidaciones quedan `lista_para_dte` indefinida-
 *     mente (operable, sin DTE presentado al SII).
 *   - `'mock'` → MockDteAdapter — in-memory, folios sintéticos. Útil en
 *     dev y staging. No retiene estado entre restarts.
 *   - `'sovos'` → SovosDteAdapter contra Paperless Chile. Exige
 *     SOVOS_API_KEY + SOVOS_BASE_URL — sin éstas, lanza
 *     `DteNotConfiguredError` (que el caller traduce a skip).
 *
 * **Singleton** por process: el factory cachea el adapter creado para
 * que MockAdapter retenga su secuencia de folios mientras el proceso
 * Node vive. SovosAdapter también se cachea para reusar el AbortController
 * pool implícito de Node fetch.
 */

let cached: { provider: string; emitter: DteEmitter | null } | null = null;

export function getDteEmitter(logger: Logger): DteEmitter | null {
  if (cached && cached.provider === appConfig.DTE_PROVIDER) {
    return cached.emitter;
  }
  cached = {
    provider: appConfig.DTE_PROVIDER,
    emitter: buildEmitter(logger),
  };
  return cached.emitter;
}

/**
 * Reset del caché — solo para tests. NO usar en producción.
 */
export function __resetDteEmitterCache(): void {
  cached = null;
}

function buildEmitter(logger: Logger): DteEmitter | null {
  switch (appConfig.DTE_PROVIDER) {
    case 'disabled':
      logger.debug('dte-emitter-factory: DTE_PROVIDER=disabled — no adapter activo');
      return null;
    case 'mock':
      logger.info('dte-emitter-factory: usando MockDteAdapter (dev/staging)');
      return new MockDteAdapter();
    case 'sovos':
      if (!appConfig.SOVOS_API_KEY || !appConfig.SOVOS_BASE_URL) {
        logger.warn(
          { hasKey: !!appConfig.SOVOS_API_KEY, hasBaseUrl: !!appConfig.SOVOS_BASE_URL },
          'dte-emitter-factory: DTE_PROVIDER=sovos pero faltan SOVOS_API_KEY/BASE_URL — adapter no creado',
        );
        return null;
      }
      try {
        logger.info(
          { baseUrl: appConfig.SOVOS_BASE_URL },
          'dte-emitter-factory: usando SovosDteAdapter',
        );
        return new SovosDteAdapter({
          apiKey: appConfig.SOVOS_API_KEY,
          baseUrl: appConfig.SOVOS_BASE_URL,
        });
      } catch (err) {
        // DteNotConfiguredError debería propagarse al startup si el
        // operador tuvo intención de Sovos; lo loggeamos y devolvemos
        // null para que el service downstream pueda decidir.
        if (err instanceof DteNotConfiguredError) {
          logger.error({ err }, 'dte-emitter-factory: SovosDteAdapter rejected config');
          return null;
        }
        throw err;
      }
  }
}
