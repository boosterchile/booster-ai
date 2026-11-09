import type { Logger } from '@booster-ai/logger';
import { Hono } from 'hono';
import type { Db } from '../db/client.js';
import type { EmailSender } from '../services/notifications/email-sender.js';

/**
 * `POST /me/confirmar-acceso-booster` (`.specs/confirmar-acceso-booster`).
 *
 * Fábrica sin handlers en este commit: los tests de `test(auth)` fallan por
 * comportamiento (404) y no por import. El handler llega en el commit
 * siguiente.
 */
export function createMeConfirmarAccesoBoosterRoutes(_opts: {
  db: Db;
  logger: Logger;
  platformAdminEmails: readonly string[];
  emailSender: EmailSender;
  webAppUrl: string;
}): Hono {
  return new Hono();
}
