import type { Logger } from '@booster-ai/logger';
import { zValidator } from '@hono/zod-validator';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { pendingDevices, vehicles } from '../db/schema.js';

/**
 * Endpoints admin para gestionar dispositivos pendientes (open enrollment
 * Teltonika).
 *
 * Auth: solo usuarios con role 'dueno' o 'admin' en su active_membership.
 *
 *   GET  /admin/dispositivos-pendientes
 *        → lista de devices que conectaron pero no tienen vehículo
 *   POST /admin/dispositivos-pendientes/:id/asociar
 *        body { vehiculo_id } → asocia device al vehículo + actualiza
 *        vehiculos.teltonika_imei
 *   POST /admin/dispositivos-pendientes/:id/rechazar
 *        body { notas? } → marca estado='rechazado'
 */

const asociarBodySchema = z.object({
  vehiculo_id: z.string().uuid(),
});

const rechazarBodySchema = z.object({
  notas: z.string().min(1).max(500).optional(),
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

  // GET /admin/dispositivos-pendientes?estado=pendiente
  app.get('/', async (c) => {
    const auth = requireAdmin(c);
    if (!auth.ok) {
      return auth.response;
    }

    const estadoParam = c.req.query('estado') ?? 'pendiente';
    const validStates = ['pendiente', 'aprobado', 'rechazado', 'reemplazado'] as const;
    type Estado = (typeof validStates)[number];
    const estado: Estado = (validStates as readonly string[]).includes(estadoParam)
      ? (estadoParam as Estado)
      : 'pendiente';

    const rows = await opts.db
      .select()
      .from(pendingDevices)
      .where(eq(pendingDevices.status, estado))
      .orderBy(desc(pendingDevices.lastConnectionAt))
      .limit(100);

    return c.json({
      devices: rows.map((r) => ({
        id: r.id,
        imei: r.imei,
        primera_conexion_en: r.firstConnectionAt,
        ultima_conexion_en: r.lastConnectionAt,
        ultima_ip_origen: r.lastSourceIp,
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
  app.post('/:id/rechazar', zValidator('json', rechazarBodySchema), async (c) => {
    const auth = requireAdmin(c);
    if (!auth.ok) {
      return auth.response;
    }

    const id = c.req.param('id');
    const body = c.req.valid('json');

    const [updated] = await opts.db
      .update(pendingDevices)
      .set({
        status: 'rechazado',
        notes: body.notas ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(pendingDevices.id, id), eq(pendingDevices.status, 'pendiente')))
      .returning();

    if (!updated) {
      return c.json({ error: 'device_not_found_or_not_pending' }, 404);
    }

    opts.logger.info({ deviceId: id, imei: updated.imei }, 'dispositivo pendiente rechazado');
    return c.json({ device_id: id, estado: 'rechazado' });
  });

  return app;
}
