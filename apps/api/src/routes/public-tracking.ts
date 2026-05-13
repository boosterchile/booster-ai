/**
 * Endpoint público para tracking del shipper / consignee (Phase 5 PR-L1).
 *
 * GET /public/tracking/:token  → estado del trip + posición reciente
 *
 * **No requiere auth** — la defensa es la opacidad del token. El handler
 * NUNCA expone:
 *   - Plate completa (solo últimos 4 chars)
 *   - Driver name / RUT
 *   - Precio
 *   - Telemetría histórica más vieja que 30 min
 *
 * **Rate limiting**: TODO post-deploy con Cloud Armor o middleware
 * propio. Por ahora confiamos en la opacidad UUID + el threshold de
 * tokens enumerables (122 bits). Pre-MVP es aceptable; antes de
 * publicarlo masivamente metemos cap (ej. 60 req/min por IP por token).
 */

import type { Logger } from '@booster-ai/logger';
import { Hono } from 'hono';
import type { Db } from '../db/client.js';
import { getPublicTracking } from '../services/get-public-tracking.js';

export function createPublicTrackingRoutes(opts: {
  db: Db;
  logger: Logger;
  /**
   * GCP project ID para X-Goog-User-Project en Routes API (ADR-038).
   * Si presente, ETA del tracking público se calcula con distancia por
   * carretera real al destino exacto (vs centroide regional). Fallback
   * transparente al método de PR-L2b si ausente o si el call falla.
   */
  routesProjectId?: string | undefined;
}) {
  const app = new Hono();

  app.get('/:token', async (c) => {
    const token = c.req.param('token');

    const result = await getPublicTracking({
      db: opts.db,
      logger: opts.logger,
      token,
      ...(opts.routesProjectId ? { routesProjectId: opts.routesProjectId } : {}),
    });

    if (result.status === 'not_found') {
      // 404 con mensaje neutro — no leak de "el token tiene formato
      // inválido" vs "el token no existe en DB".
      return c.json({ error: 'not_found' }, 404);
    }

    // Cache 30s en CDN/browser. El position se actualiza cada ~30s
    // típicamente (Teltonika emite cada 10-30s en movimiento), y queremos
    // evitar bombardeo si el consignee abre el link y refresh repetido.
    c.header('Cache-Control', 'public, max-age=30');

    return c.json(result);
  });

  return app;
}
