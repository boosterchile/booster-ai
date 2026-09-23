import { createLogger } from '@booster-ai/logger';

const logger = createLogger({
  service: '@booster-ai/matching-engine',
  version: '0.0.0-dev',
  level: 'info',
  pretty: process.env.NODE_ENV === 'development',
});

logger.info({ runtime: 'cloud-run' }, '@booster-ai/matching-engine starting (skeleton)');

// Proceso reservado. El matching productivo corre en apps/api
// (src/services/matching.ts) con @booster-ai/matching-algorithm.
// Runbook: docs/runbooks/service-matching-engine.md
// Extraer el algoritmo a este proceso no es un frente abierto.
