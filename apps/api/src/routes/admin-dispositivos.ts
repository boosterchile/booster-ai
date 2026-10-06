import type { Logger } from '@booster-ai/logger';
import { teltonikaImeiSchema } from '@booster-ai/shared-schemas';
import { zValidator } from '@hono/zod-validator';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { pendingDevices, vehicles } from '../db/schema.js';

/**
 * Asociación de un Teltonika que la empresa ya tiene en la mano.
 *
 * Auth: role 'dueno' o 'admin' de la empresa activa.
 *
 *   GET  /admin/dispositivos-pendientes?imei=
 *        → 0 o 1 device con ese IMEI. No lista la bandeja de la plataforma
 *          y no devuelve la IP de origen.
 *   POST /admin/dispositivos-pendientes/:id/asociar
 *        body { vehiculo_id } → el vehículo tiene que ser de la empresa activa.
 *   POST /admin/dispositivos-pendientes/:id/rechazar
 *        → 403. Rechazar un pending global no es una acción de la empresa
 *          (spec aislamiento-hallazgos-tenant, cierra la deuda de D2b).
 */

const listarQuerySchema = z.object({
  imei: teltonikaImeiSchema,
  estado: z.enum(['pendiente', 'aprobado', 'rechazado', 'reemplazado']).optional(),
});

const asociarBodySchema = z.object({
  vehiculo_id: z.string().uuid(),
});

export function createAdminDispositivosRoutes(opts: { db: Db; logger: Logger }) {
  const app = new Hono();

  // biome-ignore lint/suspicious/noExplicitAny: hono Context tiene generics complejos que cambian por route; usamos `any` para el helper compartido.
  function requireAdmin(c: Context<any, any, any>) {
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
    const role = active.membership.role;
    if (role !== 'dueno' && role !== 'admin') {
      return {
        ok: false as const,
        response: c.json({ error: 'forbidden', code: 'admin_required' }, 403),
      };
    }
    return { ok: true as const, userContext, activeMembership: active };
  }

  // GET /admin/dispositivos-pendientes?imei= — la empresa trae el IMEI del equipo.
  app.get('/', zValidator('query', listarQuerySchema), async (c) => {
    const auth = requireAdmin(c);
    if (!auth.ok) {
      return auth.response;
    }

    const { imei, estado } = c.req.valid('query');
    const estadoFiltro = estado ?? 'pendiente';

    const rows = await opts.db
      .select({
        id: pendingDevices.id,
        imei: pendingDevices.imei,
        firstConnectionAt: pendingDevices.firstConnectionAt,
        lastConnectionAt: pendingDevices.lastConnectionAt,
        connectionCount: pendingDevices.connectionCount,
        detectedModel: pendingDevices.detectedModel,
        status: pendingDevices.status,
        assignedToVehicleId: pendingDevices.assignedToVehicleId,
        assignedAt: pendingDevices.assignedAt,
        notes: pendingDevices.notes,
      })
      .from(pendingDevices)
      .where(and(eq(pendingDevices.imei, imei), eq(pendingDevices.status, estadoFiltro)))
      .limit(1);

    return c.json({
      devices: rows.map((r) => ({
        id: r.id,
        imei: r.imei,
        primera_conexion_en: r.firstConnectionAt,
        ultima_conexion_en: r.lastConnectionAt,
        cantidad_conexiones: r.connectionCount,
        modelo_detectado: r.detectedModel,
        estado: r.status,
        asignado_a_vehiculo_id: r.assignedToVehicleId,
        asignado_en: r.assignedAt,
        notas: r.notes,
      })),
    });
  });

  // POST /admin/dispositivos-pendientes/:id/asociar
  app.post('/:id/asociar', zValidator('json', asociarBodySchema), async (c) => {
    const auth = requireAdmin(c);
    if (!auth.ok) {
      return auth.response;
    }
    const userContext = auth.userContext;
    const empresaActiva = auth.activeMembership.empresa;

    const id = c.req.param('id');
    const body = c.req.valid('json');

    return await opts.db.transaction(async (tx) => {
      // Cargar device pendiente.
      const [device] = await tx
        .select()
        .from(pendingDevices)
        .where(eq(pendingDevices.id, id))
        .limit(1);
      if (!device) {
        return c.json({ error: 'device_not_found', code: 'device_not_found' }, 404);
      }
      if (device.status !== 'pendiente') {
        return c.json(
          {
            error: 'device_not_pending',
            code: 'device_not_pending',
            current_status: device.status,
          },
          409,
        );
      }

      // Cargar vehículo y validar pertenencia a la empresa activa.
      const [vehicle] = await tx
        .select()
        .from(vehicles)
        .where(and(eq(vehicles.id, body.vehiculo_id), eq(vehicles.empresaId, empresaActiva.id)))
        .limit(1);
      if (!vehicle) {
        return c.json({ error: 'vehicle_not_found_or_not_owned', code: 'vehicle_forbidden' }, 403);
      }
      if (vehicle.teltonikaImei && vehicle.teltonikaImei !== device.imei) {
        return c.json(
          {
            error: 'vehicle_already_has_device',
            code: 'vehicle_has_other_device',
            current_imei: vehicle.teltonikaImei,
          },
          409,
        );
      }

      // Asociar IMEI al vehículo.
      await tx
        .update(vehicles)
        .set({ teltonikaImei: device.imei, updatedAt: new Date() })
        .where(eq(vehicles.id, vehicle.id));

      // Marcar device como aprobado.
      await tx
        .update(pendingDevices)
        .set({
          status: 'aprobado',
          assignedToVehicleId: vehicle.id,
          assignedAt: new Date(),
          assignedByUserId: userContext.user.id,
          updatedAt: new Date(),
        })
        .where(eq(pendingDevices.id, id));

      opts.logger.info(
        {
          deviceId: id,
          imei: device.imei,
          vehicleId: vehicle.id,
          plate: vehicle.plate,
          empresaId: empresaActiva.id,
          asignadoPor: userContext.user.id,
        },
        'dispositivo asociado a vehículo',
      );

      return c.json({
        device_id: id,
        imei: device.imei,
        vehiculo_id: vehicle.id,
        plate: vehicle.plate,
        estado: 'aprobado',
      });
    });
  });

  // POST /admin/dispositivos-pendientes/:id/rechazar
  // La empresa no rechaza pendings de la plataforma: el id es global y
  // rechazar el de otra empresa era un corte cruzado (D2b).
  app.post('/:id/rechazar', (c) => {
    const auth = requireAdmin(c);
    if (!auth.ok) {
      return auth.response;
    }
    opts.logger.warn(
      { deviceId: c.req.param('id'), empresaId: auth.activeMembership.empresa.id },
      'rechazo de dispositivo pendiente reservado al admin de plataforma',
    );
    return c.json({ error: 'forbidden', code: 'platform_admin_required' }, 403);
  });

  return app;
}
