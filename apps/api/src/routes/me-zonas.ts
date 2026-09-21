import type { Logger } from '@booster-ai/logger';
import { zoneCreateBodySchema, zoneUpdateBodySchema } from '@booster-ai/shared-schemas';
import { zValidator } from '@hono/zod-validator';
import { and, asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { type ZoneRow, zones } from '../db/schema.js';
import { getBusinessCounter } from '../observability/business-metrics.js';
import { setResultAttributes, withBusinessSpan } from '../observability/business-span.js';
import type { UserContext } from '../services/user-context.js';

/**
 * CRUD de zonas de matching del transportista (hueco 0→1).
 *
 *   GET    /me/zonas      → lista (incluye inactivas)
 *   POST   /me/zonas      → crea (dueno|admin)
 *   PATCH  /me/zonas/:id  → tipo / activa / comunas
 *   DELETE /me/zonas/:id  → soft-deactivate (`es_activa=false`)
 *
 * El `empresa_id` sale de la membresía activa. Nunca del cliente: así no hay
 * forma de escribir zonas de otra empresa ni conociendo su UUID.
 *
 * Matching lee `zonas` en cada corrida (sin cache) — una fila nueva entra al
 * próximo matching sin redeploy. El filtro de matching es
 * `codigo_region = origen` (romano) + `tipo_zona IN ('recogida','ambos')` +
 * `es_activa=true`.
 */

const ROLES_QUE_GESTIONAN = new Set(['dueno', 'admin']);

const idParamSchema = z.object({ id: z.string().uuid() });

export function createMeZonasRoutes(opts: { db: Db; logger: Logger }): Hono {
  const app = new Hono();

  // biome-ignore lint/suspicious/noExplicitAny: hono Context genéricos.
  function requireCarrierAdmin(c: Context<any, any, any>) {
    const userContext = c.get('userContext') as UserContext | undefined;
    if (!userContext) {
      return { ok: false as const, response: c.json({ error: 'unauthorized' }, 401) };
    }
    const activa = userContext.activeMembership;
    if (!activa) {
      return {
        ok: false as const,
        response: c.json({ error: 'no_active_empresa', code: 'no_active_empresa' }, 403),
      };
    }
    const empresaId = activa.membership.empresaId ?? activa.empresa.id;
    if (!empresaId) {
      return {
        ok: false as const,
        response: c.json({ error: 'forbidden', code: 'no_es_empresa' }, 403),
      };
    }
    if (!activa.empresa.isTransportista) {
      return {
        ok: false as const,
        response: c.json({ error: 'not_a_carrier', code: 'not_a_carrier' }, 403),
      };
    }
    if (!ROLES_QUE_GESTIONAN.has(activa.membership.role)) {
      return {
        ok: false as const,
        response: c.json({ error: 'forbidden', code: 'admin_required' }, 403),
      };
    }
    return {
      ok: true as const,
      empresaId,
      userContext,
      actorUserId: userContext.user.id,
    };
  }

  app.get('/', async (c) => {
    const auth = requireCarrierAdmin(c);
    if (!auth.ok) {
      return auth.response;
    }

    // rls-allowlist: filtrado por la empresa de la membresía activa del caller.
    const rows = await opts.db
      .select()
      .from(zones)
      .where(eq(zones.empresaId, auth.empresaId))
      .orderBy(asc(zones.regionCode), asc(zones.zoneType));

    return c.json({ zonas: rows.map(serializeZone) });
  });

  app.post('/', zValidator('json', zoneCreateBodySchema), async (c) => {
    const auth = requireCarrierAdmin(c);
    if (!auth.ok) {
      return auth.response;
    }
    const body = c.req.valid('json');

    return await withBusinessSpan(
      {
        name: 'zonas.crear',
        attributes: {
          'booster.empresa_id': auth.empresaId,
          'booster.zona.region_code': body.region_code,
          'booster.zona.zone_type': body.zone_type,
        },
      },
      async (span) => {
        // rls-allowlist: lookup de duplicado scoped a la empresa activa.
        const duplicados = await opts.db
          .select({ id: zones.id })
          .from(zones)
          .where(
            and(
              eq(zones.empresaId, auth.empresaId),
              eq(zones.regionCode, body.region_code),
              eq(zones.zoneType, body.zone_type),
            ),
          )
          .limit(1);
        const duplicado = duplicados[0];
        if (duplicado) {
          return c.json({ error: 'conflict', code: 'zona_duplicada', zona_id: duplicado.id }, 409);
        }

        const inserted = await opts.db
          .insert(zones)
          .values({
            empresaId: auth.empresaId,
            regionCode: body.region_code,
            comunaCodes: body.comuna_codes ?? null,
            zoneType: body.zone_type,
            isActive: body.is_active ?? true,
          })
          .returning();
        const row = inserted[0];
        if (!row) {
          opts.logger.error({ empresaId: auth.empresaId }, 'me-zonas: INSERT no devolvió fila');
          return c.json({ error: 'internal_server_error', code: 'zona_create_failed' }, 500);
        }

        opts.logger.info(
          {
            empresaId: auth.empresaId,
            zonaId: row.id,
            regionCode: row.regionCode,
            zoneType: row.zoneType,
            isActive: row.isActive,
            actorUserId: auth.actorUserId,
          },
          'me-zonas: zona creada',
        );
        getBusinessCounter('zonas_escrituras_total').add(1, { op: 'create' });
        setResultAttributes(span, { 'booster.zona.id': row.id });

        return c.json({ zona: serializeZone(row) }, 201);
      },
    );
  });

  app.patch(
    '/:id',
    zValidator('param', idParamSchema),
    zValidator('json', zoneUpdateBodySchema),
    async (c) => {
      const auth = requireCarrierAdmin(c);
      if (!auth.ok) {
        return auth.response;
      }
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');

      return await withBusinessSpan(
        {
          name: 'zonas.actualizar',
          attributes: { 'booster.empresa_id': auth.empresaId, 'booster.zona.id': id },
        },
        async (span) => {
          // rls-allowlist: scoped a la empresa activa — id ajeno = 404.
          const existingRows = await opts.db
            .select({ id: zones.id })
            .from(zones)
            .where(and(eq(zones.id, id), eq(zones.empresaId, auth.empresaId)))
            .limit(1);
          if (!existingRows[0]) {
            return c.json({ error: 'not_found', code: 'zona_not_found' }, 404);
          }

          const updates: {
            zoneType?: ZoneRow['zoneType'];
            comunaCodes?: string[] | null;
            isActive?: boolean;
            updatedAt: Date;
          } = { updatedAt: new Date() };
          if (body.zone_type !== undefined) {
            updates.zoneType = body.zone_type;
          }
          if (body.comuna_codes !== undefined) {
            updates.comunaCodes = body.comuna_codes;
          }
          if (body.is_active !== undefined) {
            updates.isActive = body.is_active;
          }

          const updated = await opts.db
            .update(zones)
            .set(updates)
            .where(and(eq(zones.id, id), eq(zones.empresaId, auth.empresaId)))
            .returning();
          const row = updated[0];
          if (!row) {
            return c.json({ error: 'not_found', code: 'zona_not_found' }, 404);
          }

          opts.logger.info(
            {
              empresaId: auth.empresaId,
              zonaId: row.id,
              regionCode: row.regionCode,
              zoneType: row.zoneType,
              isActive: row.isActive,
              actorUserId: auth.actorUserId,
            },
            'me-zonas: zona actualizada',
          );
          getBusinessCounter('zonas_escrituras_total').add(1, { op: 'update' });
          setResultAttributes(span, { 'booster.zona.is_active': row.isActive });

          return c.json({ zona: serializeZone(row) });
        },
      );
    },
  );

  app.delete('/:id', zValidator('param', idParamSchema), async (c) => {
    const auth = requireCarrierAdmin(c);
    if (!auth.ok) {
      return auth.response;
    }
    const { id } = c.req.valid('param');

    const updated = await opts.db
      .update(zones)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(zones.id, id), eq(zones.empresaId, auth.empresaId)))
      .returning();
    const row = updated[0];
    if (!row) {
      return c.json({ error: 'not_found', code: 'zona_not_found' }, 404);
    }

    opts.logger.info(
      {
        empresaId: auth.empresaId,
        zonaId: row.id,
        regionCode: row.regionCode,
        actorUserId: auth.actorUserId,
      },
      'me-zonas: zona desactivada',
    );
    getBusinessCounter('zonas_escrituras_total').add(1, { op: 'deactivate' });

    return c.json({ ok: true, zona: serializeZone(row) });
  });

  return app;
}

function serializeZone(row: ZoneRow) {
  return {
    id: row.id,
    empresa_id: row.empresaId,
    region_code: row.regionCode,
    comuna_codes: row.comunaCodes,
    zone_type: row.zoneType,
    is_active: row.isActive,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}
