import type { Logger } from '@booster-ai/logger';
import { configuracionComercialSchema } from '@booster-ai/shared-schemas';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';
import { config as appConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { setResultAttributes, withBusinessSpan } from '../observability/business-span.js';
import {
  type LectorConfiguracionComercial,
  leerConfiguracionPublicada,
  listarHistorialConfiguracion,
  publicarConfiguracionComercial,
} from '../services/configuracion-comercial.js';
import {
  cambiarContratoProgramado,
  listarGeneradoresContratoProgramado,
} from '../services/contrato-programado.js';
import type { UserContext } from '../services/user-context.js';

/**
 * ADR-079 §3 — configuración comercial editable por el platform-admin
 * (allowlist `BOOSTER_PLATFORM_ADMIN_EMAILS`, ADR-076):
 *
 *   GET /admin/configuracion-comercial → { publicada, historial }
 *   PUT /admin/configuracion-comercial → publica una versión nueva
 *       body { config, nota_cambio }. Invariantes o nota ausente → 422.
 *
 * Un PUT publica de inmediato (no hay borradores): el cambio rige para
 * publicaciones de carga nuevas en ≤ 60 s en todas las instancias, y al
 * instante en la que atendió el PUT.
 */
const contratoProgramadoBodySchema = z.object({ activo: z.boolean() });

const putBodySchema = z.object({
  config: configuracionComercialSchema,
  nota_cambio: z.string().trim().min(1).max(500),
});

export function createAdminConfiguracionComercialRoutes(opts: {
  db: Db;
  logger: Logger;
  lector: LectorConfiguracionComercial;
}) {
  const app = new Hono();

  // biome-ignore lint/suspicious/noExplicitAny: hono Context genéricos.
  function requirePlatformAdmin(c: Context<any, any, any>) {
    const userContext = c.get('userContext') as UserContext | undefined;
    if (!userContext) {
      return { ok: false as const, response: c.json({ error: 'unauthorized' }, 401) };
    }
    const email = userContext.user.email?.toLowerCase();
    if (!email || !appConfig.BOOSTER_PLATFORM_ADMIN_EMAILS.includes(email)) {
      return {
        ok: false as const,
        response: c.json({ error: 'forbidden_platform_admin' }, 403),
      };
    }
    return { ok: true as const, adminEmail: email };
  }

  app.get('/', async (c) => {
    const auth = requirePlatformAdmin(c);
    if (!auth.ok) {
      return auth.response;
    }
    const [publicada, historial] = await Promise.all([
      leerConfiguracionPublicada(opts.db),
      listarHistorialConfiguracion(opts.db),
    ]);
    return c.json({ publicada, historial });
  });

  app.put('/', async (c) => {
    const auth = requirePlatformAdmin(c);
    if (!auth.ok) {
      return auth.response;
    }

    let crudo: unknown;
    try {
      crudo = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }
    const parsed = putBodySchema.safeParse(crudo);
    if (!parsed.success) {
      opts.logger.warn(
        { adminEmail: auth.adminEmail, issues: parsed.error.issues },
        'configuración comercial rechazada',
      );
      return c.json({ error: 'configuracion_invalida', issues: parsed.error.issues }, 422);
    }

    const publicada = await withBusinessSpan(
      { name: 'pricing.configuracion_comercial.publicar' },
      async (span) => {
        const v = await publicarConfiguracionComercial({
          db: opts.db,
          config: parsed.data.config,
          notaCambio: parsed.data.nota_cambio,
          adminEmail: auth.adminEmail,
        });
        setResultAttributes(span, { 'booster.configuracion_comercial.version': v.version });
        return v;
      },
    );
    opts.lector.invalidar();
    opts.logger.info(
      { adminEmail: auth.adminEmail, version: publicada.version },
      'configuración comercial publicada',
    );
    return c.json({ ok: true, publicada });
  });

  /**
   * ADR-079 §2 — contrato programado por generador (habilita la modalidad
   * `programada`, de tasa menor). Decisión manual del platform-admin.
   */
  app.get('/contrato-programado', async (c) => {
    const auth = requirePlatformAdmin(c);
    if (!auth.ok) {
      return auth.response;
    }
    return c.json({ generadores: await listarGeneradoresContratoProgramado(opts.db) });
  });

  app.put('/contrato-programado/:empresaId', async (c) => {
    const auth = requirePlatformAdmin(c);
    if (!auth.ok) {
      return auth.response;
    }
    const empresaId = z.string().uuid().safeParse(c.req.param('empresaId'));
    if (!empresaId.success) {
      return c.json({ error: 'invalid_empresa_id' }, 400);
    }
    let crudo: unknown;
    try {
      crudo = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }
    const body = contratoProgramadoBodySchema.safeParse(crudo);
    if (!body.success) {
      return c.json({ error: 'body_invalido', issues: body.error.issues }, 422);
    }
    const generador = await cambiarContratoProgramado({
      db: opts.db,
      empresaId: empresaId.data,
      activo: body.data.activo,
      adminEmail: auth.adminEmail,
    });
    if (!generador) {
      return c.json({ error: 'generador_no_encontrado' }, 404);
    }
    opts.logger.info(
      { adminEmail: auth.adminEmail, empresaId: empresaId.data, activo: body.data.activo },
      'contrato programado actualizado',
    );
    return c.json({ ok: true, generador });
  });

  return app;
}
