import type { Logger } from '@booster-ai/logger';
import { Hono } from 'hono';
import type { Db } from '../db/client.js';
import type { EmailSender } from '../services/notifications/email-sender.js';

/**
 * Alta del personal de Booster desde el panel (`.specs/alta-personal-booster`).
 * Esqueleto sin handlers: los tests de este commit fallan por comportamiento.
 */
export function createAdminPersonalBoosterRoutes(_opts: {
  db: Db;
  logger: Logger;
  platformAdminEmails: readonly string[];
  emailSender: EmailSender;
  webAppUrl: string;
}): Hono {
  return new Hono();
}
