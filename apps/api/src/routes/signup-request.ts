import { randomUUID } from 'node:crypto';
import type { Logger } from '@booster-ai/logger';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { submitSignupRequest } from '../services/signup-request.js';

/**
 * T8 SEC-001 Sprint 2b — `POST /api/v1/signup-request` (sec-001-cierre §3
 * H1.2 SC-1.2.1 + SC-1.2.5; ADR-052).
 *
 * Endpoint público (sin firebase auth) que reemplaza el flow
 * `createUserWithEmailAndPassword` client-side. Encadena con:
 *
 *   1. Rate-limit middleware (5/15min/IP, scope `rl:signup-request:<ip>`,
 *      fail-closed 503 si Redis down) montado upstream en server.ts.
 *   2. zValidator body — valida `{ email, nombreCompleto }`. Invalid → 422.
 *   3. Service `submitSignupRequest` — INSERT si email no en `users`,
 *      shadow si ya existe (response idéntico). Email enumeration defense.
 *
 * Response:
 *   - 202 { ok: true } — siempre que la request pasó el rate-limit + zValidator.
 *     Idéntico para `outcome=submitted` y `outcome=shadowed` (anti-enumeration).
 *   - 422 — body inválido (zValidator) o campos missing.
 *   - 429 — rate-limit fired (middleware upstream).
 *   - 503 — Redis down (middleware fail-closed) o DB throw (route catch).
 */

const signupRequestBodySchema = z.object({
  email: z.string().email().max(320),
  nombreCompleto: z.string().min(1).max(200),
});

export function createSignupRequestRoutes(opts: { db: Db; logger: Logger }): Hono {
  const app = new Hono();

  app.post('/', zValidator('json', signupRequestBodySchema), async (c) => {
    const body = c.req.valid('json');
    const correlationId = c.req.header('x-correlation-id') ?? randomUUID();

    try {
      await submitSignupRequest(opts.db, opts.logger, body, correlationId);
      // Response idéntico independiente del outcome (submitted vs shadowed)
      // — defensa contra email enumeration (SC-1.2.5).
      return c.json({ ok: true }, 202);
    } catch (err) {
      // Service-layer error (DB unreachable, INSERT throw inesperado).
      // 503 sin detail al cliente; structured log para diagnose interno.
      opts.logger.error({ err, correlationId }, 'signup-request: service threw; respondiendo 503');
      return c.json({ error: 'service_unavailable', code: 'service_unavailable' }, 503);
    }
  });

  return app;
}
