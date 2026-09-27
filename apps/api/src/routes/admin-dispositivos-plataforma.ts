import type { Logger } from '@booster-ai/logger';
import { zValidator } from '@hono/zod-validator';
import { and, desc, eq, ne } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { pendingDevices, vehicles } from '../db/schema.js';
import { requirePlatformAdmin } from '../middleware/require-platform-admin.js';
import { getBusinessCounter } from '../observability/business-metrics.js';
import { setResultAttributes, withBusinessSpan } from '../observability/business-span.js';

/**
 * Asociación de Teltonika desde platform-admin.
 *
 * El panel de la empresa (`/admin/dispositivos-pendientes`) exige ser dueño
 * o admin de ESA empresa. Este router no: el operador de Booster elige el
 * camión de cualquier transportista y no inicia sesión en su cuenta.
 *
 *   GET  /admin/plataforma/dispositivos
 *   GET  /admin/plataforma/dispositivos/vehiculos?empresa_id=
 *   POST /admin/plataforma/dispositivos/:id/asociar   { vehiculo_id }
 */

const asociarBodySchema = z.object({
  vehiculo_id: z.string().uuid(),
});

const vehiculosQuerySchema = z.object({
  empresa_id: z.string().uuid(),
});

export function createAdminDispositivosPlataformaRoutes(opts: { db: Db; logger: Logger }): Hono {
  const app = new Hono();

  app.get('/', async (c) => {
    const admin = requirePlatformAdmin(c);
    if (!admin.ok) {
      return admin.response;
    }

    // rls-allowlist: admin platform-wide query — protegido por requirePlatformAdmin.
    const rows = await opts.db
      .select({
        id: pendingDevices.id,
        imei: pendingDevices.imei,
        lastConnectionAt: pendingDevices.lastConnectionAt,
        detectedModel: pendingDevices.detectedModel,
        connectionCount: pendingDevices.connectionCount,
      })
      .from(pendingDevices)
      .where(eq(pendingDevices.status, 'pendiente'))
      .orderBy(desc(pendingDevices.lastConnectionAt))
      .limit(100);

    return c.json({
      devices: rows.map((r) => ({
        id: r.id,
        imei: r.imei,
        ultima_conexion_en: r.lastConnectionAt,
        modelo_detectado: r.detectedModel,
        cantidad_conexiones: r.connectionCount,
      })),
    });
  });

  app.get('/vehiculos', zValidator('query', vehiculosQuerySchema), async (c) => {
    const admin = requirePlatformAdmin(c);
    if (!admin.ok) {
      return admin.response;
    }
    const { empresa_id: empresaId } = c.req.valid('query');

    // rls-allowlist: admin platform-wide query — protegido por requirePlatformAdmin.
    const rows = await opts.db
      .select({
        id: vehicles.id,
        plate: vehicles.plate,
        teltonikaImei: vehicles.teltonikaImei,
      })
      .from(vehicles)
      .where(eq(vehicles.empresaId, empresaId))
      .orderBy(vehicles.plate)
      .limit(200);

    return c.json({
      vehiculos: rows.map((r) => ({
        id: r.id,
        patente: r.plate,
        teltonika_imei: r.teltonikaImei,
      })),
    });
  });

  app.post('/:id/asociar', zValidator('json', asociarBodySchema), async (c) => {
    const admin = requirePlatformAdmin(c);
    if (!admin.ok) {
      return admin.response;
    }
    const deviceId = c.req.param('id');
    if (!z.string().uuid().safeParse(deviceId).success) {
      return c.json({ error: 'invalid_id', code: 'invalid_id' }, 400);
    }
    const { vehiculo_id: vehiculoId } = c.req.valid('json');

    return await withBusinessSpan(
      {
        name: 'dispositivo.asociar_plataforma',
        attributes: { 'booster.vehiculo_id': vehiculoId },
      },
      async (span) => {
        const record = (resultado: string) => {
          getBusinessCounter('dispositivo_asociaciones_plataforma_total').add(1, { resultado });
          setResultAttributes(span, { 'dispositivo.resultado': resultado });
        };

        // rls-allowlist: admin platform-wide query — protegido por requirePlatformAdmin.
        const deviceRows = await opts.db
          .select({
            id: pendingDevices.id,
            imei: pendingDevices.imei,
            status: pendingDevices.status,
          })
          .from(pendingDevices)
          .where(eq(pendingDevices.id, deviceId))
          .limit(1);
        const device = deviceRows[0];
        if (!device) {
          record('device_not_found');
          return c.json({ error: 'not_found', code: 'device_not_found' }, 404);
        }
        if (device.status !== 'pendiente') {
          record('device_not_pending');
          return c.json(
            { error: 'conflict', code: 'device_not_pending', current_status: device.status },
            409,
          );
        }

        // rls-allowlist: admin platform-wide query — protegido por requirePlatformAdmin.
        const vehicleRows = await opts.db
          .select({
            id: vehicles.id,
            plate: vehicles.plate,
            empresaId: vehicles.empresaId,
            teltonikaImei: vehicles.teltonikaImei,
          })
          .from(vehicles)
          .where(eq(vehicles.id, vehiculoId))
          .limit(1);
        const vehicle = vehicleRows[0];
        if (!vehicle) {
          record('vehicle_not_found');
          return c.json({ error: 'not_found', code: 'vehicle_not_found' }, 404);
        }
        if (vehicle.teltonikaImei && vehicle.teltonikaImei !== device.imei) {
          record('vehicle_has_other_device');
          return c.json(
            {
              error: 'conflict',
              code: 'vehicle_has_other_device',
              current_imei: vehicle.teltonikaImei,
            },
            409,
          );
        }

        // rls-allowlist: admin platform-wide query — protegido por requirePlatformAdmin.
        const ocupado = await opts.db
          .select({ id: vehicles.id })
          .from(vehicles)
          .where(and(eq(vehicles.teltonikaImei, device.imei), ne(vehicles.id, vehicle.id)))
          .limit(1);
        if (ocupado[0]) {
          record('imei_en_uso');
          return c.json({ error: 'conflict', code: 'imei_en_uso' }, 409);
        }

        await opts.db.transaction(async (tx) => {
          await tx
            .update(vehicles)
            .set({ teltonikaImei: device.imei, updatedAt: new Date() })
            .where(eq(vehicles.id, vehicle.id));
          await tx
            .update(pendingDevices)
            .set({
              status: 'aprobado',
              assignedToVehicleId: vehicle.id,
              assignedAt: new Date(),
              assignedByUserId: admin.userContext.user.id,
              updatedAt: new Date(),
            })
            .where(and(eq(pendingDevices.id, device.id), eq(pendingDevices.status, 'pendiente')));
        });

        opts.logger.info(
          {
            deviceId: device.id,
            imei: device.imei,
            vehicleId: vehicle.id,
            empresaId: vehicle.empresaId,
            asignadoPor: admin.adminEmail,
          },
          'dispositivo asociado desde platform-admin',
        );
        record('asociado');

        return c.json({
          ok: true,
          device_id: device.id,
          imei: device.imei,
          vehiculo_id: vehicle.id,
          patente: vehicle.plate,
          empresa_id: vehicle.empresaId,
          estado: 'aprobado',
        });
      },
    );
  });

  return app;
}
