import type { Logger } from '@booster-ai/logger';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { config as appConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { emitirDteLiquidacion } from '../services/emitir-dte-liquidacion.js';
import type { UserContext } from '../services/user-context.js';

/**
 * Endpoints admin platform-wide para liquidaciones (ADR-031 + ADR-024).
 *
 * Audiencia: operadores de Booster Chile SpA listados en
 * `BOOSTER_PLATFORM_ADMIN_EMAILS`. NO admins de empresa carrier.
 *
 *   POST /admin/liquidaciones/:id/emitir-dte
 *        → reintenta emisión del DTE Tipo 33 manualmente. Idempotente:
 *          si la liquidación ya tiene folio, retorna `ya_emitido`.
 *          Útil tras transient errors o tras configurar Sovos.
 *
 * En el futuro: GET /admin/liquidaciones para listar pendientes,
 * POST /admin/liquidaciones/:id/anular para disputas, etc.
 */
export function createAdminLiquidacionesRoutes(opts: { db: Db; logger: Logger }) {
  const app = new Hono();

  // biome-ignore lint/suspicious/noExplicitAny: hono Context genéricos.
  function requirePlatformAdmin(c: Context<any, any, any>) {
    if (!appConfig.PRICING_V2_ACTIVATED) {
      return {
        ok: false as const,
        response: c.json({ error: 'feature_disabled' }, 503),
      };
    }
    const userContext = c.get('userContext') as UserContext | undefined;
    if (!userContext) {
      return { ok: false as const, response: c.json({ error: 'unauthorized' }, 401) };
    }
    const email = userContext.user.email?.toLowerCase();
    const allowlist = appConfig.BOOSTER_PLATFORM_ADMIN_EMAILS;
    if (!email || !allowlist.includes(email)) {
      return {
        ok: false as const,
        response: c.json({ error: 'forbidden_platform_admin' }, 403),
      };
    }
    return { ok: true as const, adminEmail: email };
  }

  app.post('/:id/emitir-dte', async (c) => {
    const auth = requirePlatformAdmin(c);
    if (!auth.ok) {
      return auth.response;
    }
    const liquidacionId = c.req.param('id');

    const result = await emitirDteLiquidacion({
      db: opts.db,
      logger: opts.logger,
      liquidacionId,
    });

    opts.logger.info(
      {
        liquidacionId,
        adminEmail: auth.adminEmail,
        dteStatus: result.status,
      },
      'admin: emitirDteLiquidacion manual trigger',
    );

    // Mapeo del result canónico a HTTP status.
    switch (result.status) {
      case 'liquidacion_not_found':
        return c.json({ error: 'liquidacion_not_found' }, 404);
      case 'empresa_carrier_not_found':
        return c.json({ error: 'empresa_carrier_not_found' }, 404);
      case 'skipped':
        return c.json({ ok: true, skipped: true, reason: result.reason }, 200);
      case 'ya_emitido':
        return c.json({ ok: true, already_emitted: true, folio: result.folio }, 200);
      case 'validation_error':
        return c.json({ error: 'validation_error', message: result.message }, 422);
      case 'transient_error':
        return c.json({ error: 'transient_error', message: result.message }, 503);
      case 'provider_rejected':
        return c.json(
          {
            error: 'provider_rejected',
            provider_code: result.providerCode,
            message: result.message,
          },
          502,
        );
      case 'emitido':
        return c.json(
          {
            ok: true,
            folio: result.folio,
            factura_id: result.facturaId,
            provider_track_id: result.providerTrackId,
          },
          201,
        );
    }
  });

  return app;
}
