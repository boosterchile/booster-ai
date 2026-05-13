import type { Logger } from '@booster-ai/logger';
import { Hono } from 'hono';
import { config as appConfig } from '../config.js';

/**
 * Endpoint público `GET /feature-flags`.
 *
 * ADR-035 (Wave 4) + ADR-036 (Wave 5) — el cliente necesita conocer
 * qué flags están activos ANTES de decidir qué UI renderizar. Por eso
 * este endpoint NO requiere Firebase auth: el cliente lo llama en boot
 * para resolver qué pantalla mostrar en `/login`.
 *
 * Trust boundary: los valores son booleanos derivados de env vars
 * controladas por platform-admin via Secret Manager / Terraform. El
 * usuario no puede modificarlos. Exponerlos públicamente NO crea
 * superficie de ataque adicional (lo único que se filtra es el roadmap
 * de features, info pública).
 *
 * Shape:
 *   {
 *     auth_universal_v1_activated: boolean,
 *     wake_word_voice_activated: boolean,
 *     matching_algorithm_v2_activated: boolean
 *   }
 */
export function createFeatureFlagsRoutes(opts: { logger: Logger }) {
  const app = new Hono();

  app.get('/', (c) => {
    opts.logger.debug({}, 'feature-flags: read');
    return c.json({
      auth_universal_v1_activated: appConfig.AUTH_UNIVERSAL_V1_ACTIVATED,
      wake_word_voice_activated: appConfig.WAKE_WORD_VOICE_ACTIVATED,
      matching_algorithm_v2_activated: appConfig.MATCHING_ALGORITHM_V2_ACTIVATED,
    });
  });

  return app;
}
