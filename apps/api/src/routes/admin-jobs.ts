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
import type { Db } from '../db/client.js';
import { procesarMensajesNoLeidos } from '../services/chat-whatsapp-fallback.js';

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

  return app;
}
