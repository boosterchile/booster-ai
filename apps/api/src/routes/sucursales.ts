import type { Logger } from '@booster-ai/logger';
import { regionCodeSchema } from '@booster-ai/shared-schemas';
import { zValidator } from '@hono/zod-validator';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { sucursalesEmpresa } from '../db/schema.js';

/**
 * Endpoints CRUD de sucursales de la empresa activa (shipper). Solo
 * accesibles si la empresa es generador de carga; el carrier ve sucursales
 * de otros shippers de manera read-only via los datos de las ofertas
 * (otro endpoint, fuera del scope de este módulo).
 *
 *   GET    /sucursales         → lista de sucursales (no eliminadas)
 *   POST   /sucursales         → crear (dueno/admin/despachador)
 *   PATCH  /sucursales/:id     → actualizar (mismos roles)
 *   DELETE /sucursales/:id     → soft delete (dueno/admin)
 */

const createBodySchema = z.object({
  nombre: z.string().min(1).max(100),
  address_street: z.string().min(1).max(200),
  address_city: z.string().min(1).max(100),
  address_region: regionCodeSchema,
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  operating_hours: z.string().max(200).nullable().optional(),
});

const updateBodySchema = createBodySchema.partial().extend({
  is_active: z.boolean().optional(),
});

export function createSucursalesRoutes(opts: { db: Db; logger: Logger }) {
  const app = new Hono();

  // biome-ignore lint/suspicious/noExplicitAny: hono Context generics complejos
  function requireAuth(c: Context<any, any, any>) {
    const userContext = c.get('userContext');
    if (!userContext) {
      return { ok: false as const, response: c.json({ error: 'unauthorized' }, 401) };
    }
    const active = userContext.activeMembership;
    if (!active) {
      return {
        ok: false as const,
        response: c.json({ error: 'no_active_empresa', code: 'no_active_empresa' }, 403),
      };
    }
    return { ok: true as const, userContext, activeMembership: active };
  }

  // biome-ignore lint/suspicious/noExplicitAny: hono Context generics complejos
  function requireWriteRole(c: Context<any, any, any>) {
    const auth = requireAuth(c);
    if (!auth.ok) {
      return auth;
    }
    const role = auth.activeMembership.membership.role;
    if (role !== 'dueno' && role !== 'admin' && role !== 'despachador') {
      return {
        ok: false as const,
        response: c.json({ error: 'forbidden', code: 'write_role_required' }, 403),
      };
    }
    return auth;
  }

  // biome-ignore lint/suspicious/noExplicitAny: hono Context generics complejos
  function requireDeleteRole(c: Context<any, any, any>) {
    const auth = requireAuth(c);
    if (!auth.ok) {
      return auth;
    }
    const role = auth.activeMembership.membership.role;
    if (role !== 'dueno' && role !== 'admin') {
      return {
        ok: false as const,
        response: c.json({ error: 'forbidden', code: 'admin_required' }, 403),
      };
    }
    return auth;
  }

  app.get('/', async (c) => {
    const auth = requireAuth(c);
    if (!auth.ok) {
      return auth.response;
    }
    const empresaId = auth.activeMembership.empresa.id;
    const rows = await opts.db
      .select()
      .from(sucursalesEmpresa)
      .where(and(eq(sucursalesEmpresa.empresaId, empresaId), isNull(sucursalesEmpresa.deletedAt)))
      .orderBy(asc(sucursalesEmpresa.nombre));
    return c.json({ sucursales: rows.map(serializeSucursal) });
  });

  app.get('/:id', async (c) => {
    const auth = requireAuth(c);
    if (!auth.ok) {
      return auth.response;
    }
    const id = c.req.param('id');
    const empresaId = auth.activeMembership.empresa.id;
    const [row] = await opts.db
      .select()
      .from(sucursalesEmpresa)
      .where(and(eq(sucursalesEmpresa.id, id), eq(sucursalesEmpresa.empresaId, empresaId)))
      .limit(1);
    if (!row) {
      return c.json({ error: 'sucursal_not_found' }, 404);
    }
    return c.json({ sucursal: serializeSucursal(row) });
  });

  app.post('/', zValidator('json', createBodySchema), async (c) => {
    const auth = requireWriteRole(c);
    if (!auth.ok) {
      return auth.response;
    }
    const body = c.req.valid('json');
    const empresaId = auth.activeMembership.empresa.id;

    const inserted = await opts.db
      .insert(sucursalesEmpresa)
      .values({
        empresaId,
        nombre: body.nombre,
        addressStreet: body.address_street,
        addressCity: body.address_city,
        addressRegion: body.address_region,
        latitude: body.latitude != null ? body.latitude.toString() : null,
        longitude: body.longitude != null ? body.longitude.toString() : null,
        operatingHours: body.operating_hours ?? null,
      })
      .returning();
    const row = inserted[0];
    if (!row) {
      throw new Error('Sucursal insert returned no row');
    }
    return c.json({ sucursal: serializeSucursal(row) }, 201);
  });

  app.patch('/:id', zValidator('json', updateBodySchema), async (c) => {
    const auth = requireWriteRole(c);
    if (!auth.ok) {
      return auth.response;
    }
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const empresaId = auth.activeMembership.empresa.id;

    const [existing] = await opts.db
      .select({ id: sucursalesEmpresa.id, deletedAt: sucursalesEmpresa.deletedAt })
      .from(sucursalesEmpresa)
      .where(and(eq(sucursalesEmpresa.id, id), eq(sucursalesEmpresa.empresaId, empresaId)))
      .limit(1);
    if (!existing) {
      return c.json({ error: 'sucursal_not_found' }, 404);
    }
    if (existing.deletedAt != null) {
      return c.json({ error: 'sucursal_deleted', code: 'sucursal_deleted' }, 410);
    }

    const updates: Record<string, unknown> = { updatedAt: sql`now()` };
    if (body.nombre !== undefined) {
      updates.nombre = body.nombre;
    }
    if (body.address_street !== undefined) {
      updates.addressStreet = body.address_street;
    }
    if (body.address_city !== undefined) {
      updates.addressCity = body.address_city;
    }
    if (body.address_region !== undefined) {
      updates.addressRegion = body.address_region;
    }
    if (body.latitude !== undefined) {
      updates.latitude = body.latitude == null ? null : body.latitude.toString();
    }
    if (body.longitude !== undefined) {
      updates.longitude = body.longitude == null ? null : body.longitude.toString();
    }
    if (body.operating_hours !== undefined) {
      updates.operatingHours = body.operating_hours ?? null;
    }
    if (body.is_active !== undefined) {
      updates.isActive = body.is_active;
    }

    const updated = await opts.db
      .update(sucursalesEmpresa)
      .set(updates)
      .where(eq(sucursalesEmpresa.id, id))
      .returning();
    const row = updated[0];
    if (!row) {
      return c.json({ error: 'sucursal_not_found' }, 404);
    }
    return c.json({ sucursal: serializeSucursal(row) });
  });

  app.delete('/:id', async (c) => {
    const auth = requireDeleteRole(c);
    if (!auth.ok) {
      return auth.response;
    }
    const id = c.req.param('id');
    const empresaId = auth.activeMembership.empresa.id;
    const updated = await opts.db
      .update(sucursalesEmpresa)
      .set({ deletedAt: sql`now()`, isActive: false, updatedAt: sql`now()` })
      .where(and(eq(sucursalesEmpresa.id, id), eq(sucursalesEmpresa.empresaId, empresaId)))
      .returning();
    const row = updated[0];
    if (!row) {
      return c.json({ error: 'sucursal_not_found' }, 404);
    }
    return c.json({ ok: true, sucursal_id: row.id });
  });

  return app;
}

function serializeSucursal(row: typeof sucursalesEmpresa.$inferSelect) {
  return {
    id: row.id,
    empresa_id: row.empresaId,
    nombre: row.nombre,
    address_street: row.addressStreet,
    address_city: row.addressCity,
    address_region: row.addressRegion,
    latitude: row.latitude != null ? Number.parseFloat(row.latitude) : null,
    longitude: row.longitude != null ? Number.parseFloat(row.longitude) : null,
    operating_hours: row.operatingHours,
    is_active: row.isActive,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    deleted_at: row.deletedAt,
  };
}
