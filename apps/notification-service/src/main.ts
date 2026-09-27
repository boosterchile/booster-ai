import { createLogger } from '@booster-ai/logger';

const logger = createLogger({
  service: '@booster-ai/notification-service',
  version: '0.0.0-dev',
  level: 'info',
  pretty: process.env.NODE_ENV === 'development',
});

logger.info({ runtime: 'cloud-run' }, '@booster-ai/notification-service starting (skeleton)');

// Proceso reservado. Los avisos productivos salen de apps/api
// (Web Push, WhatsApp Twilio, safety) con @booster-ai/notification-fan-out.
// Runbook: docs/runbooks/service-notification-service.md
// Extraer el fan-out a este proceso no es un frente abierto.
