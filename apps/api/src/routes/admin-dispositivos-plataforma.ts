import type { Logger } from '@booster-ai/logger';
import { teltonikaImeiSchema } from '@booster-ai/shared-schemas';
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
 *   POST /admin/plataforma/dispositivos/asignar  { vehiculo_id, teltonika_imei }
 *
 * El IMEI lo escribe el operador: el Teltonika ya está instalado y
 * configurado en el camión. No hace falta que haya llamado al gateway.
 */

const asignarBodySchema = z.object({
  vehiculo_id: z.string().uuid(),
  teltonika_imei: teltonikaImeiSchema,
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

  app.post('/asignar', zValidator('json', asignarBodySchema), async (c) => {
    const admin = requirePlatformAdmin(c);
    if (!admin.ok) {
      return admin.response;
    }
    const { vehiculo_id: vehiculoId, teltonika_imei: imei } = c.req.valid('json');

    return await withBusinessSpan(
      {
        name: 'dispositivo.asignar_plataforma',
        attributes: { 'booster.vehiculo_id': vehiculoId },
      },
      async (span) => {
        const record = (resultado: string) => {
          getBusinessCounter('dispositivo_asociaciones_plataforma_total').add(1, { resultado });
          setResultAttributes(span, { 'dispositivo.resultado': resultado });
        };

        // rls-allowlist: admin platform-wide query — protegido por requirePlatformAdmin.
        const vehicleRows = await opts.db
          .select({
            id: vehicles.id,
            plate: vehicles.plate,
            empresaId: vehicles.empresaId,
            teltonikaImei: vehicles.teltonikaImei,
            teltonikaImeiEspejo: vehicles.teltonikaImeiEspejo,
          })
          .from(vehicles)
          .where(eq(vehicles.id, vehiculoId))
          .limit(1);
        const vehicle = vehicleRows[0];
        if (!vehicle) {
          record('vehicle_not_found');
          return c.json({ error: 'not_found', code: 'vehicle_not_found' }, 404);
        }
        if (vehicle.teltonikaImeiEspejo !== null) {
          record('imei_espejo_activo');
          return c.json({ error: 'conflict', code: 'imei_espejo_activo' }, 422);
        }

        // rls-allowlist: admin platform-wide query — protegido por requirePlatformAdmin.
        const ocupado = await opts.db
          .select({ id: vehicles.id })
          .from(vehicles)
          .where(and(eq(vehicles.teltonikaImei, imei), ne(vehicles.id, vehicle.id)))
          .limit(1);
        if (ocupado[0]) {
          record('imei_en_uso');
          return c.json({ error: 'conflict', code: 'imei_en_uso' }, 409);
        }

        // rls-allowlist: admin platform-wide query — protegido por requirePlatformAdmin.
        const pendingRows = await opts.db
          .select({
            id: pendingDevices.id,
            status: pendingDevices.status,
            assignedToVehicleId: pendingDevices.assignedToVehicleId,
          })
          .from(pendingDevices)
          .where(eq(pendingDevices.imei, imei))
          .limit(1);
        const pending = pendingRows[0];
        if (
          pending?.status === 'aprobado' &&
          pending.assignedToVehicleId !== null &&
          pending.assignedToVehicleId !== vehicle.id
        ) {
          record('imei_en_uso');
          return c.json({ error: 'conflict', code: 'imei_en_uso' }, 409);
        }
        if (pending?.status === 'rechazado') {
          record('imei_rechazado');
          return c.json({ error: 'conflict', code: 'imei_rechazado' }, 409);
        }

        const reconciliacion = pending ? 'aprobado' : 'sin_registro';
        try {
          await opts.db.transaction(async (tx) => {
            // rls-allowlist: admin platform-wide — protegido por requirePlatformAdmin.
            await tx
              .update(vehicles)
              .set({ teltonikaImei: imei, updatedAt: new Date() })
              .where(eq(vehicles.id, vehicle.id));
            if (vehicle.teltonikaImei !== null && vehicle.teltonikaImei !== imei) {
              await tx
                .update(pendingDevices)
                .set({ status: 'reemplazado', updatedAt: new Date() })
                .where(
                  and(
                    eq(pendingDevices.imei, vehicle.teltonikaImei),
                    eq(pendingDevices.status, 'aprobado'),
                    eq(pendingDevices.assignedToVehicleId, vehicle.id),
                  ),
                );
            }
            if (pending && (pending.status === 'pendiente' || pending.status === 'reemplazado')) {
              await tx
                .update(pendingDevices)
                .set({
                  status: 'aprobado',
                  assignedToVehicleId: vehicle.id,
                  assignedAt: new Date(),
                  assignedByUserId: admin.userContext.user.id,
                  updatedAt: new Date(),
                })
                .where(eq(pendingDevices.id, pending.id));
            }
          });
        } catch (err) {
          if (pgErrorCode(err) === '23505') {
            record('imei_en_uso');
            return c.json({ error: 'conflict', code: 'imei_en_uso' }, 409);
          }
          throw err;
        }

        opts.logger.info(
          {
            vehicleId: vehicle.id,
            empresaId: vehicle.empresaId,
            reconciliacion,
            asignadoPor: admin.adminEmail,
          },
          'IMEI Teltonika asignado desde platform-admin',
        );
        record(reconciliacion);

        return c.json({
          ok: true,
          vehiculo_id: vehicle.id,
          patente: vehicle.plate,
          empresa_id: vehicle.empresaId,
          teltonika_imei: imei,
          reconciliacion,
        });
      },
    );
  });

  return app;
}

function pgErrorCode(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) {
    return undefined;
  }
  if ('code' in err && typeof err.code === 'string') {
    return err.code;
  }
  if ('cause' in err) {
    return pgErrorCode(err.cause);
  }
  return undefined;
}
