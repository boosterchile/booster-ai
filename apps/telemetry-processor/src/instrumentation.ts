/**
 * Entry de instrumentación OTel — se carga vía `node --import` ANTES de
 * main.js (ver Dockerfile). NO importar desde main.ts: en ESM la
 * auto-instrumentación debe registrarse antes de que los módulos a
 * instrumentar evalúen (spec feat-otel-bootstrap §6.1).
 */
import { initOtel } from '@booster-ai/otel-bootstrap';

initOtel({
  serviceName: '@booster-ai/telemetry-processor',
  serviceVersion: process.env.SERVICE_VERSION ?? '0.0.0-dev',
});
