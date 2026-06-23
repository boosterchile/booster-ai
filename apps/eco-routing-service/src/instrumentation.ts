/**
 * OTel bootstrap — cargado con --import ANTES de main.ts (ESM requirement).
 * Ver apps/telemetry-processor/src/instrumentation.ts para el patrón.
 */
import { initOtel } from '@booster-ai/otel-bootstrap';

initOtel({
  serviceName: '@booster-ai/eco-routing-service',
  serviceVersion: process.env.SERVICE_VERSION ?? '0.0.0-dev',
});
