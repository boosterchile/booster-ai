import type { Logger } from '@booster-ai/logger';
import { rankearCandidatos } from '@booster-ai/matching-algorithm';
import { solicitudRankingSchema } from '@booster-ai/shared-schemas';
import { Hono } from 'hono';
import type { VerificadorToken } from './auth.js';

/**
 * matching-engine (T10-21): ranking de candidatos de un viaje con
 * `@booster-ai/matching-algorithm`. Cómputo puro: sin base de datos ni
 * efectos; el api arma la solicitud y persiste las offers.
 * Spec: `.specs/matching-engine-t10-21/spec.md`.
 */
export function crearApp(opts: { logger: Logger; verificarToken: VerificadorToken }): Hono {
  const { logger, verificarToken } = opts;
  const app = new Hono();

  app.get('/health', (c) => c.json({ status: 'ok', service: 'matching-engine' }));

  app.post('/ranking', async (c) => {
    const auth = await verificarToken(c.req.header('authorization'));
    if (!auth.ok) {
      return c.json({ error: 'unauthorized' }, 401);
    }

    let crudo: unknown;
    try {
      crudo = await c.req.json();
    } catch {
      logger.warn('ranking: body no es JSON');
      return c.json({ error: 'invalid_json' }, 400);
    }
    const parsed = solicitudRankingSchema.safeParse(crudo);
    if (!parsed.success) {
      logger.warn({ errors: parsed.error.issues }, 'ranking: solicitud fuera de contrato');
      return c.json({ error: 'invalid_request', issues: parsed.error.issues }, 400);
    }

    const inicio = Date.now();
    try {
      const resultado = rankearCandidatos(parsed.data);
      logger.info(
        {
          algoritmo: resultado.algoritmo,
          candidatos: resultado.candidatosEvaluados,
          ofertas: resultado.top.length,
          latenciaMs: Date.now() - inicio,
        },
        'ranking calculado',
      );
      return c.json(resultado, 200);
    } catch (err) {
      // Única falla posible del algoritmo puro: pesos v2 inválidos (failsafe
      // de scoreCandidateV2). Es un error del llamador, no del servicio.
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'ranking: solicitud rechazada por el algoritmo',
      );
      return c.json(
        { error: 'unprocessable', message: err instanceof Error ? err.message : String(err) },
        422,
      );
    }
  });

  return app;
}
