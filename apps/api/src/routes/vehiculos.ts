import type { Logger } from '@booster-ai/logger';
import { chileanPlateSchema } from '@booster-ai/shared-schemas';
import { zValidator } from '@hono/zod-validator';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { telemetryPoints, vehicles } from '../db/schema.js';

/**
 * Endpoints de vehículos. CRUD completo:
 *
 *   GET    /vehiculos          → lista de la empresa activa (todos los users)
 *   POST   /vehiculos          → crear (dueno/admin/despachador)
 *   GET    /vehiculos/:id      → detalle (todos los users)
 *   PATCH  /vehiculos/:id      → actualizar (dueno/admin/despachador)
 *   DELETE /vehiculos/:id      → soft delete = vehicleStatus 'retirado'
 *                                (dueno/admin)
 *
 * Reglas multi-tenant:
 *   - Todos los reads y writes filtran por activeMembership.empresa.id.
 *   - Patente única en el sistema (constraint DB). Si choca → 409.
 *   - teltonika_imei se asigna desde /admin/dispositivos-pendientes
 *     (asociar). Acá NO se permite setearlo directamente para no abrir un
 *     flujo paralelo al de open enrollment — devolvemos 400 si vienen.
 */

const vehicleTypes = [
  'camioneta',
  'furgon_pequeno',
  'furgon_mediano',
  'camion_pequeno',
  'camion_mediano',
  'camion_pesado',
  'semi_remolque',
  'refrigerado',
  'tanque',
] as const;

const fuelTypes = [
  'diesel',
  'gasolina',
  'gas_glp',
  'gas_gnc',
  'electrico',
  'hibrido_diesel',
  'hibrido_gasolina',
  'hidrogeno',
] as const;

const vehicleStatuses = ['activo', 'mantenimiento', 'retirado'] as const;

// Patente chilena. Acepta input con o sin separadores (·, -, ., espacios) y
// en cualquier capitalización; persiste en formato canónico de 6 chars
// `[A-Z]{4}\d{2}` (ej: BCDF12). Schema centralizado en
// @booster-ai/shared-schemas para que cliente y servidor compartan reglas.
//
// Reemplaza el schema laxo previo que aceptaba `....`, `XXX-99`, `1234`, etc.
// porque solo validaba caracteres + min(4), no la estructura chilena.
const createBodySchema = z.object({
  plate: chileanPlateSchema,
  vehicle_type: z.enum(vehicleTypes),
  capacity_kg: z.number().int().positive().max(100_000),
  capacity_m3: z.number().int().positive().max(500).nullable().optional(),
  year: z.number().int().min(1980).max(2100).nullable().optional(),
  brand: z.string().min(1).max(50).nullable().optional(),
  model: z.string().min(1).max(100).nullable().optional(),
  fuel_type: z.enum(fuelTypes).nullable().optional(),
  curb_weight_kg: z.number().int().positive().max(50_000).nullable().optional(),
  consumption_l_per_100km_baseline: z.number().positive().max(99.99).nullable().optional(),
});

const updateBodySchema = createBodySchema.partial().extend({
  vehicle_status: z.enum(vehicleStatuses).optional(),
});

export function createVehiculosRoutes(opts: { db: Db; logger: Logger }) {
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

  // ---------------------------------------------------------------------
  // GET / — lista de vehículos de la empresa activa.
  // ---------------------------------------------------------------------
  app.get('/', async (c) => {
    const auth = requireAuth(c);
    if (!auth.ok) {
      return auth.response;
    }

    const rows = await opts.db
      .select({
        id: vehicles.id,
        plate: vehicles.plate,
        type: vehicles.vehicleType,
        capacity_kg: vehicles.capacityKg,
        capacity_m3: vehicles.capacityM3,
        year: vehicles.year,
        brand: vehicles.brand,
        model: vehicles.model,
        fuel_type: vehicles.fuelType,
        curb_weight_kg: vehicles.curbWeightKg,
        consumption_l_per_100km_baseline: vehicles.consumptionLPer100kmBaseline,
        teltonika_imei: vehicles.teltonikaImei,
        status: vehicles.vehicleStatus,
        created_at: vehicles.createdAt,
        updated_at: vehicles.updatedAt,
      })
      .from(vehicles)
      .where(eq(vehicles.empresaId, auth.activeMembership.empresa.id))
      .orderBy(asc(vehicles.plate));

    return c.json({ vehicles: rows });
  });

  // ---------------------------------------------------------------------
  // GET /flota — vehículos de la empresa con su última ubicación.
  //
  // Versión bulk de /:id/ubicacion: una sola query con LATERAL JOIN
  // (vía subselect DISTINCT ON) que retorna todos los vehículos de la
  // empresa activa + su último punto GPS (si existe). Pensado para la
  // vista de seguimiento de flota (/app/flota) que necesita renderizar
  // un mapa con N markers sin N+1 round trips.
  //
  // Vehículos sin Teltonika asociado o sin telemetría todavía aparecen
  // con `position: null`. La UI los muestra como "Sin posición aún".
  // ---------------------------------------------------------------------
  app.get('/flota', async (c) => {
    const auth = requireAuth(c);
    if (!auth.ok) {
      return auth.response;
    }
    const empresaId = auth.activeMembership.empresa.id;

    const vehicleRows = await opts.db
      .select({
        id: vehicles.id,
        plate: vehicles.plate,
        type: vehicles.vehicleType,
        teltonika_imei: vehicles.teltonikaImei,
        status: vehicles.vehicleStatus,
      })
      .from(vehicles)
      .where(eq(vehicles.empresaId, empresaId))
      .orderBy(asc(vehicles.plate));

    const vehicleIds = vehicleRows.map((v) => v.id);
    type LastPoint = {
      vehicle_id: string;
      timestamp_device: Date;
      latitude: string | null;
      longitude: string | null;
      speed_kmh: number | null;
      angle_deg: number | null;
    };
    const lastPoints =
      vehicleIds.length === 0
        ? ([] as LastPoint[])
        : await opts.db
            .selectDistinctOn([telemetryPoints.vehicleId], {
              vehicle_id: telemetryPoints.vehicleId,
              timestamp_device: telemetryPoints.timestampDevice,
              latitude: telemetryPoints.latitude,
              longitude: telemetryPoints.longitude,
              speed_kmh: telemetryPoints.speedKmh,
              angle_deg: telemetryPoints.angleDeg,
            })
            .from(telemetryPoints)
            .where(inArray(telemetryPoints.vehicleId, vehicleIds))
            .orderBy(telemetryPoints.vehicleId, desc(telemetryPoints.timestampDevice));

    const lastById = new Map<string, LastPoint>();
    for (const p of lastPoints) {
      if (p.vehicle_id != null) {
        lastById.set(p.vehicle_id, p);
      }
    }

    const fleet = vehicleRows.map((v) => {
      const point = lastById.get(v.id);
      return {
        id: v.id,
        plate: v.plate,
        type: v.type,
        teltonika_imei: v.teltonika_imei,
        status: v.status,
        position: point
          ? {
              timestamp_device: point.timestamp_device,
              latitude: point.latitude != null ? Number.parseFloat(point.latitude) : null,
              longitude: point.longitude != null ? Number.parseFloat(point.longitude) : null,
              speed_kmh: point.speed_kmh,
              angle_deg: point.angle_deg,
            }
          : null,
      };
    });

    return c.json({ fleet });
  });

  // ---------------------------------------------------------------------
  // POST / — crear vehículo.
  // ---------------------------------------------------------------------
  app.post('/', zValidator('json', createBodySchema), async (c) => {
    const auth = requireWriteRole(c);
    if (!auth.ok) {
      return auth.response;
    }
    const body = c.req.valid('json');
    const empresaId = auth.activeMembership.empresa.id;

    try {
      const [created] = await opts.db
        .insert(vehicles)
        .values({
          empresaId,
          plate: body.plate,
          vehicleType: body.vehicle_type,
          capacityKg: body.capacity_kg,
          capacityM3: body.capacity_m3 ?? null,
          year: body.year ?? null,
          brand: body.brand ?? null,
          model: body.model ?? null,
          fuelType: body.fuel_type ?? null,
          curbWeightKg: body.curb_weight_kg ?? null,
          consumptionLPer100kmBaseline:
            body.consumption_l_per_100km_baseline != null
              ? body.consumption_l_per_100km_baseline.toString()
              : null,
        })
        .returning();

      if (!created) {
        opts.logger.error({ empresaId, body }, 'insert vehiculo no devolvió row');
        return c.json({ error: 'insert_failed' }, 500);
      }
      opts.logger.info(
        { vehicleId: created.id, plate: created.plate, empresaId },
        'vehículo creado',
      );
      return c.json({ vehicle: serializeVehicle(created) }, 201);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === '23505') {
        // unique_violation — patente o IMEI duplicado.
        return c.json({ error: 'plate_already_exists', code: 'plate_duplicate' }, 409);
      }
      throw err;
    }
  });

  // ---------------------------------------------------------------------
  // GET /:id — detalle.
  // ---------------------------------------------------------------------
  app.get('/:id', async (c) => {
    const auth = requireAuth(c);
    if (!auth.ok) {
      return auth.response;
    }
    const id = c.req.param('id');

    const [row] = await opts.db
      .select()
      .from(vehicles)
      .where(and(eq(vehicles.id, id), eq(vehicles.empresaId, auth.activeMembership.empresa.id)))
      .limit(1);

    if (!row) {
      return c.json({ error: 'vehicle_not_found' }, 404);
    }
    return c.json({ vehicle: serializeVehicle(row) });
  });

  // ---------------------------------------------------------------------
  // PATCH /:id — actualizar campos parciales.
  // ---------------------------------------------------------------------
  app.patch('/:id', zValidator('json', updateBodySchema), async (c) => {
    const auth = requireWriteRole(c);
    if (!auth.ok) {
      return auth.response;
    }
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const empresaId = auth.activeMembership.empresa.id;

    // Verificar ownership antes del update.
    const [existing] = await opts.db
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(and(eq(vehicles.id, id), eq(vehicles.empresaId, empresaId)))
      .limit(1);
    if (!existing) {
      return c.json({ error: 'vehicle_not_found' }, 404);
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.plate !== undefined) {
      updates.plate = body.plate;
    }
    if (body.vehicle_type !== undefined) {
      updates.vehicleType = body.vehicle_type;
    }
    if (body.capacity_kg !== undefined) {
      updates.capacityKg = body.capacity_kg;
    }
    if (body.capacity_m3 !== undefined) {
      updates.capacityM3 = body.capacity_m3;
    }
    if (body.year !== undefined) {
      updates.year = body.year;
    }
    if (body.brand !== undefined) {
      updates.brand = body.brand;
    }
    if (body.model !== undefined) {
      updates.model = body.model;
    }
    if (body.fuel_type !== undefined) {
      updates.fuelType = body.fuel_type;
    }
    if (body.curb_weight_kg !== undefined) {
      updates.curbWeightKg = body.curb_weight_kg;
    }
    if (body.consumption_l_per_100km_baseline !== undefined) {
      updates.consumptionLPer100kmBaseline =
        body.consumption_l_per_100km_baseline != null
          ? body.consumption_l_per_100km_baseline.toString()
          : null;
    }
    if (body.vehicle_status !== undefined) {
      updates.vehicleStatus = body.vehicle_status;
    }

    try {
      const [updated] = await opts.db
        .update(vehicles)
        .set(updates)
        .where(and(eq(vehicles.id, id), eq(vehicles.empresaId, empresaId)))
        .returning();

      if (!updated) {
        return c.json({ error: 'vehicle_not_found' }, 404);
      }
      opts.logger.info(
        { vehicleId: id, plate: updated.plate, empresaId, fields: Object.keys(updates) },
        'vehículo actualizado',
      );
      return c.json({ vehicle: serializeVehicle(updated) });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === '23505') {
        return c.json({ error: 'plate_already_exists', code: 'plate_duplicate' }, 409);
      }
      throw err;
    }
  });

  // ---------------------------------------------------------------------
  // DELETE /:id — soft delete (vehicleStatus = 'retirado').
  // No hard-delete porque vehicles está referenciado por trip_assignments,
  // telemetria_puntos, etc. Borrar rompería integridad.
  // ---------------------------------------------------------------------
  app.delete('/:id', async (c) => {
    const auth = requireDeleteRole(c);
    if (!auth.ok) {
      return auth.response;
    }
    const id = c.req.param('id');
    const empresaId = auth.activeMembership.empresa.id;

    const [updated] = await opts.db
      .update(vehicles)
      .set({ vehicleStatus: 'retirado', updatedAt: new Date() })
      .where(and(eq(vehicles.id, id), eq(vehicles.empresaId, empresaId)))
      .returning();

    if (!updated) {
      return c.json({ error: 'vehicle_not_found' }, 404);
    }

    opts.logger.info({ vehicleId: id, plate: updated.plate, empresaId }, 'vehículo retirado');
    return c.json({ vehicle: serializeVehicle(updated) });
  });

  // ---------------------------------------------------------------------
  // GET /:id/telemetria — últimos puntos de telemetría del vehículo.
  //
  // Limit default 50, max 500. Sirve para confirmar que el processor
  // está poblando telemetria_puntos (post asociación a Teltonika) +
  // pantalla de "actividad reciente" en /app/vehiculos/:id.
  // ---------------------------------------------------------------------
  app.get('/:id/telemetria', async (c) => {
    const auth = requireAuth(c);
    if (!auth.ok) {
      return auth.response;
    }
    const id = c.req.param('id');
    const empresaId = auth.activeMembership.empresa.id;

    const limitParam = Number.parseInt(c.req.query('limit') ?? '50', 10);
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 500) : 50;

    // Verificar ownership del vehículo antes de exponer telemetría.
    const [vehicle] = await opts.db
      .select({ id: vehicles.id, plate: vehicles.plate, teltonikaImei: vehicles.teltonikaImei })
      .from(vehicles)
      .where(and(eq(vehicles.id, id), eq(vehicles.empresaId, empresaId)))
      .limit(1);
    if (!vehicle) {
      return c.json({ error: 'vehicle_not_found' }, 404);
    }

    const rows = await opts.db
      .select({
        id: telemetryPoints.id,
        imei: telemetryPoints.imei,
        timestamp_device: telemetryPoints.timestampDevice,
        timestamp_received_at: telemetryPoints.timestampReceivedAt,
        priority: telemetryPoints.priority,
        longitude: telemetryPoints.longitude,
        latitude: telemetryPoints.latitude,
        altitude_m: telemetryPoints.altitudeM,
        angle_deg: telemetryPoints.angleDeg,
        satellites: telemetryPoints.satellites,
        speed_kmh: telemetryPoints.speedKmh,
        event_io_id: telemetryPoints.eventIoId,
      })
      .from(telemetryPoints)
      .where(eq(telemetryPoints.vehicleId, id))
      .orderBy(desc(telemetryPoints.timestampDevice))
      .limit(limit);

    return c.json({
      vehicle_id: id,
      plate: vehicle.plate,
      teltonika_imei: vehicle.teltonikaImei,
      count: rows.length,
      points: rows.map((r) => ({
        id: r.id.toString(), // bigint → string para JSON
        imei: r.imei,
        timestamp_device: r.timestamp_device,
        timestamp_received_at: r.timestamp_received_at,
        priority: r.priority,
        longitude: r.longitude,
        latitude: r.latitude,
        altitude_m: r.altitude_m,
        angle_deg: r.angle_deg,
        satellites: r.satellites,
        speed_kmh: r.speed_kmh,
        event_io_id: r.event_io_id,
      })),
    });
  });

  // ---------------------------------------------------------------------
  // GET /:id/ubicacion — último punto GPS del vehículo (para mapas).
  //
  // Versión liviana de /:id/telemetria optimizada para "dónde está ahora".
  // Devuelve solo el último point (no array). 404 si vehículo no tiene
  // teltonika asociado o no se han recibido packets.
  // ---------------------------------------------------------------------
  app.get('/:id/ubicacion', async (c) => {
    const auth = requireAuth(c);
    if (!auth.ok) {
      return auth.response;
    }
    const id = c.req.param('id');
    const empresaId = auth.activeMembership.empresa.id;

    const [vehicle] = await opts.db
      .select({ id: vehicles.id, plate: vehicles.plate, teltonikaImei: vehicles.teltonikaImei })
      .from(vehicles)
      .where(and(eq(vehicles.id, id), eq(vehicles.empresaId, empresaId)))
      .limit(1);
    if (!vehicle) {
      return c.json({ error: 'vehicle_not_found' }, 404);
    }
    if (!vehicle.teltonikaImei) {
      return c.json({ error: 'no_teltonika', code: 'no_teltonika', plate: vehicle.plate }, 404);
    }

    const [last] = await opts.db
      .select({
        timestamp_device: telemetryPoints.timestampDevice,
        timestamp_received_at: telemetryPoints.timestampReceivedAt,
        longitude: telemetryPoints.longitude,
        latitude: telemetryPoints.latitude,
        altitude_m: telemetryPoints.altitudeM,
        angle_deg: telemetryPoints.angleDeg,
        satellites: telemetryPoints.satellites,
        speed_kmh: telemetryPoints.speedKmh,
        priority: telemetryPoints.priority,
      })
      .from(telemetryPoints)
      .where(eq(telemetryPoints.vehicleId, id))
      .orderBy(desc(telemetryPoints.timestampDevice))
      .limit(1);

    if (!last) {
      return c.json(
        {
          error: 'no_points_yet',
          code: 'no_points_yet',
          plate: vehicle.plate,
          imei: vehicle.teltonikaImei,
        },
        404,
      );
    }

    return c.json({
      vehicle_id: id,
      plate: vehicle.plate,
      teltonika_imei: vehicle.teltonikaImei,
      ubicacion: {
        timestamp_device: last.timestamp_device,
        timestamp_received_at: last.timestamp_received_at,
        latitude: last.latitude != null ? Number.parseFloat(last.latitude) : null,
        longitude: last.longitude != null ? Number.parseFloat(last.longitude) : null,
        altitude_m: last.altitude_m,
        angle_deg: last.angle_deg,
        satellites: last.satellites,
        speed_kmh: last.speed_kmh,
        priority: last.priority,
      },
    });
  });

  return app;
}

function serializeVehicle(row: typeof vehicles.$inferSelect) {
  return {
    id: row.id,
    plate: row.plate,
    type: row.vehicleType,
    capacity_kg: row.capacityKg,
    capacity_m3: row.capacityM3,
    year: row.year,
    brand: row.brand,
    model: row.model,
    fuel_type: row.fuelType,
    curb_weight_kg: row.curbWeightKg,
    consumption_l_per_100km_baseline: row.consumptionLPer100kmBaseline,
    teltonika_imei: row.teltonikaImei,
    status: row.vehicleStatus,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}
