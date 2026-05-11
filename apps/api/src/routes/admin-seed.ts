import type { Logger } from '@booster-ai/logger';
import type { Auth } from 'firebase-admin/auth';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { config as appConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { deleteDemo, seedDemo } from '../services/seed-demo.js';
import type { UserContext } from '../services/user-context.js';

/**
 * Endpoints admin platform-wide para el seed demo (D1).
 *
 * Audiencia: operadores de Booster Chile SpA listados en
 * `BOOSTER_PLATFORM_ADMIN_EMAILS`.
 *
 *   POST /admin/seed/demo
 *     → Crea (o reusa idempotentemente) el set demo: 2 empresas, 2 dueños
 *       Firebase, 2 sucursales, 2 vehículos (uno con IMEI espejo a Van
 *       Oosterwyk), 1 conductor con PIN. Devuelve credenciales para login.
 *
 *   DELETE /admin/seed/demo
 *     → Borra todo lo creado por el seed (cascada en orden seguro).
 *       Reversa total — Van Oosterwyk queda intocada.
 */

export function createAdminSeedRoutes(opts: { db: Db; firebaseAuth: Auth; logger: Logger }) {
  const app = new Hono();

  // biome-ignore lint/suspicious/noExplicitAny: hono Context genéricos.
  function requirePlatformAdmin(c: Context<any, any, any>) {
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

  app.post('/demo', async (c) => {
    const auth = requirePlatformAdmin(c);
    if (!auth.ok) {
      return auth.response;
    }
    opts.logger.info({ adminEmail: auth.adminEmail }, 'admin/seed/demo POST');
    try {
      const credentials = await seedDemo({
        db: opts.db,
        firebaseAuth: opts.firebaseAuth,
        logger: opts.logger,
      });
      return c.json({ ok: true, credentials });
    } catch (err) {
      opts.logger.error({ err }, 'admin/seed/demo failed');
      return c.json({ error: 'seed_failed', detail: (err as Error).message }, 500);
    }
  });

  app.delete('/demo', async (c) => {
    const auth = requirePlatformAdmin(c);
    if (!auth.ok) {
      return auth.response;
    }
    opts.logger.info({ adminEmail: auth.adminEmail }, 'admin/seed/demo DELETE');
    try {
      const result = await deleteDemo({ db: opts.db, logger: opts.logger });
      return c.json({ ok: true, ...result });
    } catch (err) {
      opts.logger.error({ err }, 'admin/seed/demo DELETE failed');
      return c.json({ error: 'delete_failed', detail: (err as Error).message }, 500);
    }
  });

  return app;
}
