import { Hono } from 'hono';
import { config } from '../config.js';

/**
 * T8 + T13 SEC-001 Sprint 2b — `GET /health/signup-flow` liveness probe
 * (sec-001-cierre §3 H1.2 SC-1.2.3).
 *
 * Endpoint específico para el synthetic monitor `signup-probe` que T13
 * configura en `infrastructure/monitoring/signup-probe.tf` (Cloud Monitoring
 * uptime check cada 60s). Permite distinguir entre "API API entera caída"
 * (cae `/health` también) vs "signup flow caído pero resto API OK" — útil
 * para alerting fino post-Sprint-2b ship.
 *
 * Liveness por contrato: NO toca BD ni Redis. Si responde 200, indica que
 * el proceso está vivo y el route está montado. Para readiness (DB ping)
 * usar `/ready` (cubre toda la API, no signup-specific).
 *
 * No-cache headers para que el probe Cloud Monitoring siempre golpee el
 * proceso real, no un CDN intermedio.
 */
export function createHealthSignupFlowRouter(): Hono {
  const app = new Hono();

  app.get('/signup-flow', (c) => {
    c.header('Cache-Control', 'no-store, no-cache, must-revalidate');
    return c.json({
      status: 'ok',
      flow: 'signup-request',
      service: config.SERVICE_NAME,
      version: config.SERVICE_VERSION,
      timestamp: new Date().toISOString(),
    });
  });

  return app;
}
