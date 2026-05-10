/**
 * Endpoints internos disparados por Cloud Scheduler (P3.d y futuros).
 *
 * Auth: OIDC token con `email` claim == INTERNAL_CRON_CALLER_SA. El
 * middleware se aplica externamente en server.ts (mismo
 * createAuthMiddleware que usamos para el bot, distinta env var).
 *
 * Endpoints disponibles:
 *   - POST /chat-whatsapp-fallback — tick del cron de fallback WhatsApp
 *     para mensajes de chat no leídos > 5 min.
 *
 * Convenciones:
 *   - Devolver 200 con body resumen (counts) cuando todo OK, incluso si
 *     no había trabajo (Cloud Scheduler considera 200 como success y no
 *     reintenta).
 *   - Devolver 503 si la feature no está configurada (no es un error
 *     ejecutar el cron sin Twilio; logueamos warn y retornamos
 *     skipped:true).
 *   - 5xx solo si hay un crash inesperado.
 */

import type { Logger } from '@booster-ai/logger';
import type { TwilioWhatsAppClient } from '@booster-ai/whatsapp-client';
import { Hono } from 'hono';
import { config as appConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { procesarMensajesNoLeidos } from '../services/chat-whatsapp-fallback.js';
import { procesarCobranzaCobraHoy } from '../services/procesar-cobranza-cobra-hoy.js';

export function createAdminJobsRoutes(opts: {
  db: Db;
  logger: Logger;
  twilioClient: TwilioWhatsAppClient | null;
  contentSidChatUnread: string | null;
  webAppUrl: string;
}) {
  const app = new Hono();

  app.post('/chat-whatsapp-fallback', async (c) => {
    const result = await procesarMensajesNoLeidos({
      db: opts.db,
      logger: opts.logger,
      twilioClient: opts.twilioClient,
      contentSid: opts.contentSidChatUnread,
      webAppUrl: opts.webAppUrl,
    });

    return c.json({
      ok: true,
      ...result,
    });
  });

  /**
   * ADR-029 v1 / ADR-032 — tick diario de cobranza Cobra Hoy.
   *
   * Detecta adelantos `desembolsado` cuyo plazo del shipper venció y
   * los transiciona a `mora`. Idempotente, seguro de re-correr.
   *
   * Si `FACTORING_V1_ACTIVATED=false`, retorna 200 con `skipped:true`
   * (no es un error — el cron sigue activo aunque la feature esté off
   * por entornos de staging).
   */
  app.post('/cobra-hoy-cobranza', async (c) => {
    if (!appConfig.FACTORING_V1_ACTIVATED) {
      opts.logger.debug('cobra-hoy-cobranza: FACTORING_V1_ACTIVATED=false, skip');
      return c.json({ ok: true, skipped: true, reason: 'feature_disabled' });
    }
    const result = await procesarCobranzaCobraHoy({
      db: opts.db,
      logger: opts.logger,
    });
    return c.json({
      ok: true,
      moras_creadas: result.morasCreadas,
      adelantos: result.adelantos.map((a) => ({
        adelanto_id: a.adelantoId,
        empresa_carrier_id: a.empresaCarrierId,
        empresa_shipper_id: a.empresaShipperId,
        dias_vencidos: a.diasVencidos,
      })),
    });
  });

  return app;
}
