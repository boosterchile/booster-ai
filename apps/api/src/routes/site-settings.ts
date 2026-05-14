import { randomUUID } from 'node:crypto';
import type { Logger } from '@booster-ai/logger';
import { siteConfigSchema } from '@booster-ai/shared-schemas';
import { Storage } from '@google-cloud/storage';
import { zValidator } from '@hono/zod-validator';
import { desc, eq, max } from 'drizzle-orm';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';
import { config as appConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { configuracionSitio } from '../db/schema.js';
import type { UserContext } from '../services/user-context.js';

/**
 * ADR-039 — Site Settings Runtime Configuration.
 *
 * Endpoints para editar marca + copy del sitio sin redeploy.
 *
 * Endpoint público (sin auth, cache 5min en cliente):
 *   GET /public/site-settings → { config: SiteConfig, version }
 *
 * Endpoints admin (auth Firebase + platform-admin allowlist):
 *   GET    /admin/site-settings           → publicada + history últimas 20
 *   GET    /admin/site-settings/:version  → versión específica
 *   POST   /admin/site-settings/draft     → crear nueva versión (no publicada)
 *   POST   /admin/site-settings/publish   → publicar versión existente (id en body)
 *   POST   /admin/site-settings/rollback  → revertir a versión X (target_version)
 *   POST   /admin/site-settings/assets    → upload logo/favicon → GCS → URL
 */

let cachedStorage: Storage | null = null;
function getStorage(): Storage {
  if (!cachedStorage) {
    cachedStorage = new Storage();
  }
  return cachedStorage;
}

const ALLOWED_MIME_TYPES = ['image/svg+xml', 'image/png', 'image/jpeg'] as const;
const MAX_ASSET_BYTES = 500 * 1024; // 500 KB

const publishBodySchema = z.object({
  id: z.string().uuid(),
});

const rollbackBodySchema = z.object({
  target_version: z.number().int().positive(),
});

const draftBodySchema = z.object({
  config: siteConfigSchema,
  nota: z.string().min(1).max(500).optional(),
});

/**
 * Sanitiza SVG contra XSS — bloquea <script>, on*=, javascript: hrefs.
 * Defensiva: si el contenido tiene cualquiera de esos patrones, rechaza
 * el upload. NO intenta "limpiar" el SVG (eso es trabajo de DOMPurify).
 */
function svgIsSafe(buffer: Buffer): boolean {
  const text = buffer.toString('utf-8');
  if (text.length > MAX_ASSET_BYTES) {
    return false;
  }
  const dangerous = [
    /<script\b/i,
    /\son[a-z]+\s*=/i,
    /javascript:/i,
    /<iframe\b/i,
    /<object\b/i,
    /<embed\b/i,
    /<foreignObject\b/i,
  ];
  return !dangerous.some((rgx) => rgx.test(text));
}

export function createSiteSettingsRoutes(opts: {
  db: Db;
  logger: Logger;
  publicAssetsBucket: string;
}) {
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

  /**
   * GET /admin/site-settings — versión publicada + history de 20 más recientes.
   */
  app.get('/', async (c) => {
    const auth = requirePlatformAdmin(c);
    if (!auth.ok) {
      return auth.response;
    }

    // rls-allowlist: admin platform-wide read — protegido por requirePlatformAdmin.
    const published = await opts.db
      .select()
      .from(configuracionSitio)
      .where(eq(configuracionSitio.publicada, true))
      .limit(1);

    // rls-allowlist: admin platform-wide history — protegido por requirePlatformAdmin.
    const history = await opts.db
      .select()
      .from(configuracionSitio)
      .orderBy(desc(configuracionSitio.creadoEn))
      .limit(20);

    return c.json({
      published: published[0] ?? null,
      history,
    });
  });

  /**
   * GET /admin/site-settings/:version — versión específica.
   */
  app.get('/:version', async (c) => {
    const auth = requirePlatformAdmin(c);
    if (!auth.ok) {
      return auth.response;
    }

    const versionParam = Number.parseInt(c.req.param('version'), 10);
    if (!Number.isInteger(versionParam) || versionParam < 1) {
      return c.json({ error: 'invalid_version' }, 400);
    }

    // rls-allowlist: admin platform-wide read by version — protegido por requirePlatformAdmin.
    const rows = await opts.db
      .select()
      .from(configuracionSitio)
      .where(eq(configuracionSitio.version, versionParam))
      .limit(1);

    if (rows.length === 0) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json({ version: rows[0] });
  });

  /**
   * POST /admin/site-settings/draft — crea nueva versión NO publicada.
   * Si quieres publicarla inmediatamente, llama /publish con el id devuelto.
   */
  app.post('/draft', zValidator('json', draftBodySchema), async (c) => {
    const auth = requirePlatformAdmin(c);
    if (!auth.ok) {
      return auth.response;
    }
    const body = c.req.valid('json');

    // Calcular próxima versión.
    // rls-allowlist: admin platform-wide max version — protegido por requirePlatformAdmin.
    const maxRow = await opts.db
      .select({ maxVersion: max(configuracionSitio.version) })
      .from(configuracionSitio);
    const nextVersion = (maxRow[0]?.maxVersion ?? 0) + 1;

    // rls-allowlist: admin platform-wide insert — protegido por requirePlatformAdmin.
    const inserted = await opts.db
      .insert(configuracionSitio)
      .values({
        version: nextVersion,
        config: body.config,
        publicada: false,
        notaPublicacion: body.nota ?? null,
        creadoPorEmail: auth.adminEmail,
      })
      .returning();

    opts.logger.info(
      { adminEmail: auth.adminEmail, version: nextVersion },
      'site-settings draft created',
    );
    return c.json({ ok: true, draft: inserted[0] });
  });

  /**
   * POST /admin/site-settings/publish — marca una versión como publicada,
   * desmarca todas las demás. Atómico vía transacción.
   */
  app.post('/publish', zValidator('json', publishBodySchema), async (c) => {
    const auth = requirePlatformAdmin(c);
    if (!auth.ok) {
      return auth.response;
    }
    const { id } = c.req.valid('json');

    try {
      await opts.db.transaction(async (tx) => {
        // rls-allowlist: admin platform-wide bulk update — protegido por requirePlatformAdmin.
        await tx
          .update(configuracionSitio)
          .set({ publicada: false })
          .where(eq(configuracionSitio.publicada, true));

        // rls-allowlist: admin platform-wide single publish — protegido por requirePlatformAdmin.
        await tx
          .update(configuracionSitio)
          .set({ publicada: true })
          .where(eq(configuracionSitio.id, id));
      });
    } catch (err) {
      opts.logger.error({ err, id }, 'site-settings publish failed');
      return c.json({ error: 'publish_failed', detail: (err as Error).message }, 500);
    }

    opts.logger.info({ adminEmail: auth.adminEmail, id }, 'site-settings published');
    return c.json({ ok: true, published_id: id });
  });

  /**
   * POST /admin/site-settings/rollback — revertir a la versión `target_version`.
   * Marca esa versión como publicada (y desmarca las demás).
   */
  app.post('/rollback', zValidator('json', rollbackBodySchema), async (c) => {
    const auth = requirePlatformAdmin(c);
    if (!auth.ok) {
      return auth.response;
    }
    const { target_version } = c.req.valid('json');

    // rls-allowlist: admin platform-wide read for rollback — protegido por requirePlatformAdmin.
    const target = await opts.db
      .select()
      .from(configuracionSitio)
      .where(eq(configuracionSitio.version, target_version))
      .limit(1);

    if (target.length === 0) {
      return c.json({ error: 'version_not_found' }, 404);
    }

    try {
      await opts.db.transaction(async (tx) => {
        // rls-allowlist: admin platform-wide bulk update — protegido por requirePlatformAdmin.
        await tx
          .update(configuracionSitio)
          .set({ publicada: false })
          .where(eq(configuracionSitio.publicada, true));

        // rls-allowlist: admin platform-wide single rollback — protegido por requirePlatformAdmin.
        await tx
          .update(configuracionSitio)
          .set({ publicada: true })
          .where(eq(configuracionSitio.version, target_version));
      });
    } catch (err) {
      opts.logger.error({ err, target_version }, 'site-settings rollback failed');
      return c.json({ error: 'rollback_failed', detail: (err as Error).message }, 500);
    }

    opts.logger.info({ adminEmail: auth.adminEmail, target_version }, 'site-settings rolled back');
    return c.json({ ok: true, published_version: target_version });
  });

  /**
   * POST /admin/site-settings/assets — upload de logo/favicon a GCS público.
   * Recibe multipart/form-data con field `file`. Valida MIME + size +
   * sanitiza SVG. Retorna URL pública.
   */
  app.post('/assets', async (c) => {
    const auth = requirePlatformAdmin(c);
    if (!auth.ok) {
      return auth.response;
    }

    const formData = await c.req.formData().catch(() => null);
    if (!formData) {
      return c.json({ error: 'multipart_required' }, 400);
    }
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return c.json({ error: 'file_missing' }, 400);
    }

    const mime = file.type;
    if (!ALLOWED_MIME_TYPES.includes(mime as (typeof ALLOWED_MIME_TYPES)[number])) {
      return c.json({ error: 'mime_not_allowed', allowed: ALLOWED_MIME_TYPES }, 400);
    }
    if (file.size > MAX_ASSET_BYTES) {
      return c.json({ error: 'file_too_large', max_bytes: MAX_ASSET_BYTES }, 413);
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    if (mime === 'image/svg+xml' && !svgIsSafe(buffer)) {
      return c.json({ error: 'svg_unsafe_content' }, 400);
    }

    const ext = mime === 'image/svg+xml' ? 'svg' : mime === 'image/png' ? 'png' : 'jpg';
    const objectName = `assets/site/${randomUUID()}.${ext}`;
    const gcsFile = getStorage().bucket(opts.publicAssetsBucket).file(objectName);

    try {
      await gcsFile.save(buffer, {
        contentType: mime,
        metadata: {
          cacheControl: 'public, max-age=3600',
        },
      });
    } catch (err) {
      opts.logger.error({ err, objectName }, 'site-settings asset upload failed');
      return c.json({ error: 'upload_failed' }, 500);
    }

    const url = `https://storage.googleapis.com/${opts.publicAssetsBucket}/${objectName}`;
    opts.logger.info(
      { adminEmail: auth.adminEmail, objectName, mime },
      'site-settings asset uploaded',
    );
    return c.json({ ok: true, url });
  });

  return app;
}

/**
 * Endpoint público — sin auth, retorna la versión publicada.
 * Cache 5min en cliente, sin cache server (siempre lee BD para que
 * publish/rollback aparezca inmediato).
 */
export function createPublicSiteSettingsRoutes(opts: { db: Db; logger: Logger }) {
  const app = new Hono();

  app.get('/site-settings', async (c) => {
    // rls-allowlist: lectura pública de configuración publicada (sin PII).
    const rows = await opts.db
      .select({
        version: configuracionSitio.version,
        config: configuracionSitio.config,
        creadoEn: configuracionSitio.creadoEn,
      })
      .from(configuracionSitio)
      .where(eq(configuracionSitio.publicada, true))
      .limit(1);

    if (rows.length === 0) {
      return c.json({ error: 'no_published_version' }, 404);
    }

    c.header('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
    const row = rows[0];
    if (!row) {
      return c.json({ error: 'no_published_version' }, 404);
    }
    return c.json({
      version: row.version,
      config: row.config,
      updated_at: row.creadoEn,
    });
  });

  return app;
}
