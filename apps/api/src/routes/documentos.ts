import type { Logger } from '@booster-ai/logger';
import { zValidator } from '@hono/zod-validator';
import { and, asc, desc, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import {
  conductores,
  documentosConductor,
  documentosVehiculo,
  users as usersTable,
  vehicles,
} from '../db/schema.js';
import { calcularEstadoDocumento } from '../services/compliance-estado.js';

/**
 * D6 — Endpoints de documentos vehículo + conductor + dashboard de
 * cumplimiento.
 *
 *   GET    /documentos/vehiculo/:vehiculoId    → lista docs del vehículo
 *   POST   /documentos/vehiculo/:vehiculoId    → crear doc vehículo
 *   PATCH  /documentos/vehiculo/:id            → editar
 *   DELETE /documentos/vehiculo/:id            → hard delete (es metadata)
 *
 *   GET    /documentos/conductor/:conductorId  → lista docs del conductor
 *   POST   /documentos/conductor/:conductorId  → crear doc conductor
 *   PATCH  /documentos/conductor/:id           → editar
 *   DELETE /documentos/conductor/:id           → hard delete
 *
 *   GET    /cumplimiento                       → dashboard "qué vence pronto"
 *
 * Auth: carrier write roles (dueño/admin/despachador). Reads sin filtro
 * de rol — toda persona del carrier ve docs (incluso conductor read-only).
 *
 * Multi-tenant: GET filtra por activeMembership.empresa.id (via JOIN a
 * vehiculos.empresa_id o conductores.empresa_id).
 */

const VEHICLE_DOC_TYPES = [
  'revision_tecnica',
  'permiso_circulacion',
  'soap',
  'padron',
  'seguro_carga',
  'poliza_responsabilidad',
  'certificado_emisiones',
  'otro',
] as const;

const DRIVER_DOC_TYPES = [
  'licencia_conducir',
  'curso_b6',
  'certificado_antecedentes',
  'examen_psicotecnico',
  'hoja_vida_conductor',
  'certificado_salud',
  'otro',
] as const;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha debe ser ISO YYYY-MM-DD');

const createVehicleDocSchema = z.object({
  tipo: z.enum(VEHICLE_DOC_TYPES),
  archivo_url: z.string().url().nullable().optional(),
  fecha_emision: isoDate.nullable().optional(),
  fecha_vencimiento: isoDate.nullable().optional(),
  notas: z.string().max(500).nullable().optional(),
});

const updateVehicleDocSchema = createVehicleDocSchema.partial();

const createDriverDocSchema = z.object({
  tipo: z.enum(DRIVER_DOC_TYPES),
  archivo_url: z.string().url().nullable().optional(),
  fecha_emision: isoDate.nullable().optional(),
  fecha_vencimiento: isoDate.nullable().optional(),
  notas: z.string().max(500).nullable().optional(),
});

const updateDriverDocSchema = createDriverDocSchema.partial();

export function createDocumentosRoutes(opts: { db: Db; logger: Logger }) {
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

  function parseDate(s: string | null | undefined): Date | null {
    if (!s) {
      return null;
    }
    return new Date(`${s}T00:00:00.000Z`);
  }

  function serializeVehicleDoc(row: typeof documentosVehiculo.$inferSelect) {
    return {
      id: row.id,
      vehiculo_id: row.vehicleId,
      tipo: row.tipo,
      archivo_url: row.archivoUrl,
      fecha_emision:
        row.fechaEmision instanceof Date
          ? row.fechaEmision.toISOString().slice(0, 10)
          : row.fechaEmision,
      fecha_vencimiento:
        row.fechaVencimiento instanceof Date
          ? row.fechaVencimiento.toISOString().slice(0, 10)
          : row.fechaVencimiento,
      estado: row.estado,
      notas: row.notas,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
    };
  }

  function serializeDriverDoc(row: typeof documentosConductor.$inferSelect) {
    return {
      id: row.id,
      conductor_id: row.conductorId,
      tipo: row.tipo,
      archivo_url: row.archivoUrl,
      fecha_emision:
        row.fechaEmision instanceof Date
          ? row.fechaEmision.toISOString().slice(0, 10)
          : row.fechaEmision,
      fecha_vencimiento:
        row.fechaVencimiento instanceof Date
          ? row.fechaVencimiento.toISOString().slice(0, 10)
          : row.fechaVencimiento,
      estado: row.estado,
      notas: row.notas,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
    };
  }

  // ---------------------------------------------------------------------
  // VEHÍCULOS
  // ---------------------------------------------------------------------

  app.get('/vehiculo/:vehiculoId', async (c) => {
    const auth = requireAuth(c);
    if (!auth.ok) {
      return auth.response;
    }
    const vehiculoId = c.req.param('vehiculoId');
    const empresaId = auth.activeMembership.empresa.id;

    const [vehicle] = await opts.db
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(and(eq(vehicles.id, vehiculoId), eq(vehicles.empresaId, empresaId)))
      .limit(1);
    if (!vehicle) {
      return c.json({ error: 'vehicle_not_found' }, 404);
    }

    const rows = await opts.db
      .select()
      .from(documentosVehiculo)
      .where(eq(documentosVehiculo.vehicleId, vehiculoId))
      .orderBy(desc(documentosVehiculo.updatedAt));

    return c.json({ documentos: rows.map(serializeVehicleDoc) });
  });

  app.post('/vehiculo/:vehiculoId', zValidator('json', createVehicleDocSchema), async (c) => {
    const auth = requireWriteRole(c);
    if (!auth.ok) {
      return auth.response;
    }
    const vehiculoId = c.req.param('vehiculoId');
    const body = c.req.valid('json');
    const empresaId = auth.activeMembership.empresa.id;

    const [vehicle] = await opts.db
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(and(eq(vehicles.id, vehiculoId), eq(vehicles.empresaId, empresaId)))
      .limit(1);
    if (!vehicle) {
      return c.json({ error: 'vehicle_not_found' }, 404);
    }

    const fechaVencimiento = parseDate(body.fecha_vencimiento);
    const estado = calcularEstadoDocumento(fechaVencimiento);

    const inserted = await opts.db
      .insert(documentosVehiculo)
      .values({
        vehicleId: vehiculoId,
        tipo: body.tipo,
        archivoUrl: body.archivo_url ?? null,
        fechaEmision: parseDate(body.fecha_emision),
        fechaVencimiento,
        estado,
        notas: body.notas ?? null,
      })
      .returning();
    const row = inserted[0];
    if (!row) {
      throw new Error('vehicle doc insert returned no row');
    }
    return c.json({ documento: serializeVehicleDoc(row) }, 201);
  });

  app.patch('/vehiculo-doc/:id', zValidator('json', updateVehicleDocSchema), async (c) => {
    const auth = requireWriteRole(c);
    if (!auth.ok) {
      return auth.response;
    }
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const empresaId = auth.activeMembership.empresa.id;

    // Verificar ownership via JOIN.
    const [existing] = await opts.db
      .select({ id: documentosVehiculo.id, fechaVencimiento: documentosVehiculo.fechaVencimiento })
      .from(documentosVehiculo)
      .innerJoin(vehicles, eq(vehicles.id, documentosVehiculo.vehicleId))
      .where(and(eq(documentosVehiculo.id, id), eq(vehicles.empresaId, empresaId)))
      .limit(1);
    if (!existing) {
      return c.json({ error: 'documento_not_found' }, 404);
    }

    const updates: Record<string, unknown> = { updatedAt: sql`now()` };
    if (body.tipo !== undefined) {
      updates.tipo = body.tipo;
    }
    if (body.archivo_url !== undefined) {
      updates.archivoUrl = body.archivo_url ?? null;
    }
    if (body.fecha_emision !== undefined) {
      updates.fechaEmision = parseDate(body.fecha_emision);
    }
    if (body.fecha_vencimiento !== undefined) {
      const newVencimiento = parseDate(body.fecha_vencimiento);
      updates.fechaVencimiento = newVencimiento;
      updates.estado = calcularEstadoDocumento(newVencimiento);
    }
    if (body.notas !== undefined) {
      updates.notas = body.notas ?? null;
    }

    const updated = await opts.db
      .update(documentosVehiculo)
      .set(updates)
      .where(eq(documentosVehiculo.id, id))
      .returning();
    const row = updated[0];
    if (!row) {
      return c.json({ error: 'documento_not_found' }, 404);
    }
    return c.json({ documento: serializeVehicleDoc(row) });
  });

  app.delete('/vehiculo-doc/:id', async (c) => {
    const auth = requireWriteRole(c);
    if (!auth.ok) {
      return auth.response;
    }
    const id = c.req.param('id');
    const empresaId = auth.activeMembership.empresa.id;

    // Ownership check + delete en uno: usamos subquery con vehicle_id válido.
    const ownVehicleIds = opts.db
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(eq(vehicles.empresaId, empresaId));
    const deleted = await opts.db
      .delete(documentosVehiculo)
      .where(
        and(eq(documentosVehiculo.id, id), inArray(documentosVehiculo.vehicleId, ownVehicleIds)),
      )
      .returning({ id: documentosVehiculo.id });
    if (deleted.length === 0) {
      return c.json({ error: 'documento_not_found' }, 404);
    }
    return c.json({ ok: true });
  });

  // ---------------------------------------------------------------------
  // CONDUCTORES
  // ---------------------------------------------------------------------

  app.get('/conductor/:conductorId', async (c) => {
    const auth = requireAuth(c);
    if (!auth.ok) {
      return auth.response;
    }
    const conductorId = c.req.param('conductorId');
    const empresaId = auth.activeMembership.empresa.id;

    const [conductor] = await opts.db
      .select({ id: conductores.id })
      .from(conductores)
      .where(and(eq(conductores.id, conductorId), eq(conductores.empresaId, empresaId)))
      .limit(1);
    if (!conductor) {
      return c.json({ error: 'conductor_not_found' }, 404);
    }

    const rows = await opts.db
      .select()
      .from(documentosConductor)
      .where(eq(documentosConductor.conductorId, conductorId))
      .orderBy(desc(documentosConductor.updatedAt));

    return c.json({ documentos: rows.map(serializeDriverDoc) });
  });

  app.post('/conductor/:conductorId', zValidator('json', createDriverDocSchema), async (c) => {
    const auth = requireWriteRole(c);
    if (!auth.ok) {
      return auth.response;
    }
    const conductorId = c.req.param('conductorId');
    const body = c.req.valid('json');
    const empresaId = auth.activeMembership.empresa.id;

    const [conductor] = await opts.db
      .select({ id: conductores.id })
      .from(conductores)
      .where(and(eq(conductores.id, conductorId), eq(conductores.empresaId, empresaId)))
      .limit(1);
    if (!conductor) {
      return c.json({ error: 'conductor_not_found' }, 404);
    }

    const fechaVencimiento = parseDate(body.fecha_vencimiento);
    const estado = calcularEstadoDocumento(fechaVencimiento);

    const inserted = await opts.db
      .insert(documentosConductor)
      .values({
        conductorId,
        tipo: body.tipo,
        archivoUrl: body.archivo_url ?? null,
        fechaEmision: parseDate(body.fecha_emision),
        fechaVencimiento,
        estado,
        notas: body.notas ?? null,
      })
      .returning();
    const row = inserted[0];
    if (!row) {
      throw new Error('driver doc insert returned no row');
    }
    return c.json({ documento: serializeDriverDoc(row) }, 201);
  });

  app.patch('/conductor-doc/:id', zValidator('json', updateDriverDocSchema), async (c) => {
    const auth = requireWriteRole(c);
    if (!auth.ok) {
      return auth.response;
    }
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const empresaId = auth.activeMembership.empresa.id;

    const [existing] = await opts.db
      .select({ id: documentosConductor.id })
      .from(documentosConductor)
      .innerJoin(conductores, eq(conductores.id, documentosConductor.conductorId))
      .where(and(eq(documentosConductor.id, id), eq(conductores.empresaId, empresaId)))
      .limit(1);
    if (!existing) {
      return c.json({ error: 'documento_not_found' }, 404);
    }

    const updates: Record<string, unknown> = { updatedAt: sql`now()` };
    if (body.tipo !== undefined) {
      updates.tipo = body.tipo;
    }
    if (body.archivo_url !== undefined) {
      updates.archivoUrl = body.archivo_url ?? null;
    }
    if (body.fecha_emision !== undefined) {
      updates.fechaEmision = parseDate(body.fecha_emision);
    }
    if (body.fecha_vencimiento !== undefined) {
      const newVencimiento = parseDate(body.fecha_vencimiento);
      updates.fechaVencimiento = newVencimiento;
      updates.estado = calcularEstadoDocumento(newVencimiento);
    }
    if (body.notas !== undefined) {
      updates.notas = body.notas ?? null;
    }

    const updated = await opts.db
      .update(documentosConductor)
      .set(updates)
      .where(eq(documentosConductor.id, id))
      .returning();
    const row = updated[0];
    if (!row) {
      return c.json({ error: 'documento_not_found' }, 404);
    }
    return c.json({ documento: serializeDriverDoc(row) });
  });

  app.delete('/conductor-doc/:id', async (c) => {
    const auth = requireWriteRole(c);
    if (!auth.ok) {
      return auth.response;
    }
    const id = c.req.param('id');
    const empresaId = auth.activeMembership.empresa.id;
    const ownConductorIds = opts.db
      .select({ id: conductores.id })
      .from(conductores)
      .where(eq(conductores.empresaId, empresaId));
    const deleted = await opts.db
      .delete(documentosConductor)
      .where(
        and(
          eq(documentosConductor.id, id),
          inArray(documentosConductor.conductorId, ownConductorIds),
        ),
      )
      .returning({ id: documentosConductor.id });
    if (deleted.length === 0) {
      return c.json({ error: 'documento_not_found' }, 404);
    }
    return c.json({ ok: true });
  });

  return app;
}

/**
 * D6 — Endpoint dashboard `/cumplimiento`. Devuelve resumen + listas
 * priorizadas por urgencia (vencido > por_vencer > vigente).
 *
 * Mantenido en un router aparte para que se monte en `/cumplimiento` raíz
 * en server.ts (sin colisionar con `/documentos/*`).
 */
export function createCumplimientoRoutes(opts: { db: Db; logger: Logger }) {
  const app = new Hono();

  // biome-ignore lint/suspicious/noExplicitAny: hono Context generics
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
    return { ok: true as const, activeMembership: active };
  }

  app.get('/', async (c) => {
    const auth = requireAuth(c);
    if (!auth.ok) {
      return auth.response;
    }
    const empresaId = auth.activeMembership.empresa.id;

    // 1. Vehicle docs: solo de vehículos no retirados de esta empresa, no
    //    vigentes (vencidos o por vencer).
    const vehicleDocs = await opts.db
      .select({
        id: documentosVehiculo.id,
        vehicleId: documentosVehiculo.vehicleId,
        plate: vehicles.plate,
        tipo: documentosVehiculo.tipo,
        estado: documentosVehiculo.estado,
        fechaVencimiento: documentosVehiculo.fechaVencimiento,
      })
      .from(documentosVehiculo)
      .innerJoin(vehicles, eq(vehicles.id, documentosVehiculo.vehicleId))
      .where(
        and(
          eq(vehicles.empresaId, empresaId),
          ne(vehicles.vehicleStatus, 'retirado'),
          isNotNull(documentosVehiculo.fechaVencimiento),
          ne(documentosVehiculo.estado, 'vigente'),
        ),
      )
      .orderBy(asc(documentosVehiculo.fechaVencimiento));

    // 2. Driver docs: solo conductores no eliminados.
    const driverDocs = await opts.db
      .select({
        id: documentosConductor.id,
        conductorId: documentosConductor.conductorId,
        fullName: usersTable.fullName,
        rut: usersTable.rut,
        tipo: documentosConductor.tipo,
        estado: documentosConductor.estado,
        fechaVencimiento: documentosConductor.fechaVencimiento,
      })
      .from(documentosConductor)
      .innerJoin(conductores, eq(conductores.id, documentosConductor.conductorId))
      .innerJoin(usersTable, eq(usersTable.id, conductores.userId))
      .where(
        and(
          eq(conductores.empresaId, empresaId),
          isNotNull(documentosConductor.fechaVencimiento),
          ne(documentosConductor.estado, 'vigente'),
        ),
      )
      .orderBy(asc(documentosConductor.fechaVencimiento));

    const vencidoCount =
      vehicleDocs.filter((d) => d.estado === 'vencido').length +
      driverDocs.filter((d) => d.estado === 'vencido').length;
    const porVencerCount =
      vehicleDocs.filter((d) => d.estado === 'por_vencer').length +
      driverDocs.filter((d) => d.estado === 'por_vencer').length;

    return c.json({
      resumen: {
        vencidos: vencidoCount,
        por_vencer_30d: porVencerCount,
        total_pendientes: vencidoCount + porVencerCount,
      },
      vehiculos: vehicleDocs.map((d) => ({
        documento_id: d.id,
        vehiculo_id: d.vehicleId,
        plate: d.plate,
        tipo: d.tipo,
        estado: d.estado,
        fecha_vencimiento:
          d.fechaVencimiento instanceof Date
            ? d.fechaVencimiento.toISOString().slice(0, 10)
            : d.fechaVencimiento,
      })),
      conductores: driverDocs.map((d) => ({
        documento_id: d.id,
        conductor_id: d.conductorId,
        full_name: d.fullName,
        rut: d.rut,
        tipo: d.tipo,
        estado: d.estado,
        fecha_vencimiento:
          d.fechaVencimiento instanceof Date
            ? d.fechaVencimiento.toISOString().slice(0, 10)
            : d.fechaVencimiento,
      })),
    });
  });

  return app;
}
