import { createLogger } from '@booster-ai/logger';

const logger = createLogger({
  service: '@booster-ai/telemetry-tcp-gateway',
  version: '0.0.0-dev',
  level: 'info',
  pretty: process.env.NODE_ENV === 'development',
});

logger.info({ runtime: 'gke-autopilot' }, '@booster-ai/telemetry-tcp-gateway starting (skeleton)');

// TODO: implementar según el ADR correspondiente.
// Ver docs/adr/ y skills/ para el plan de implementación.
