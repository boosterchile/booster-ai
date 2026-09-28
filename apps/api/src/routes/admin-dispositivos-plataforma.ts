import type { Logger } from '@booster-ai/logger';
import {
  chileanPlateSchema,
  derivarUnidadDesdeTipoLegacy,
  fuelTypeSchema,
  teltonikaImeiSchema,
  validarCoherenciaUnidadVehiculo,
  vehicleTypeSchema,
} from '@booster-ai/shared-schemas';
import { zValidator } from '@hono/zod-validator';
import { and, desc, eq, ne } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { empresas, pendingDevices, vehicles } from '../db/schema.js';
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
 *   POST /admin/plataforma/dispositivos/habilitar
 *        { empresa_id, teltonika_imei, plate, vehicle_type, capacity_kg, ... }
 *
 * Dos caminos. Si la empresa ya cargó el vehículo, `asignar` solo escribe
 * el IMEI. Si no, `habilitar` crea el vehículo en esa empresa y le escribe
 * el IMEI. La empresa puede hacer el alta desde su flota. El Teltonika ya
 * está instalado: no hace falta que haya llamado al gateway.
 */

const asignarBodySchema = z.object({
  vehiculo_id: z.string().uuid(),
  teltonika_imei: teltonikaImeiSchema,
});

const vehiculosQuerySchema = z.object({
  empresa_id: z.string().uuid(),
});

const habilitarBodySchema = z.object({
  empresa_id: z.string().uuid(),
  teltonika_imei: teltonikaImeiSchema,
  plate: chileanPlateSchema,
  vehicle_type: vehicleTypeSchema,
  capacity_kg: z.number().int().min(0).max(100_000),
  capacity_m3: z.number().int().positive().max(500).nullable().optional(),
  year: z.number().int().min(1980).max(2100).nullable().optional(),
  brand: z.string().min(1).max(50).nullable().optional(),
  model: z.string().min(1).max(100).nullable().optional(),
  fuel_type: fuelTypeSchema.nullable().optional(),
  curb_weight_kg: z.number().int().positive().max(50_000).nullable().optional(),
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

  app.post('/habilitar', zValidator('json', habilitarBodySchema), async (c) => {
    const admin = requirePlatformAdmin(c);
    if (!admin.ok) {
      return admin.response;
    }
    const body = c.req.valid('json');

    return await withBusinessSpan(
      {
        name: 'dispositivo.habilitar_plataforma',
        attributes: { 'booster.empresa_id': body.empresa_id },
      },
      async (span) => {
        const record = (resultado: string) => {
          getBusinessCounter('dispositivo_habilitaciones_plataforma_total').add(1, { resultado });
          setResultAttributes(span, { 'dispositivo.resultado': resultado });
        };

        // rls-allowlist: admin platform-wide query — protegido por requirePlatformAdmin.
        const empresaRows = await opts.db
          .select({
            id: empresas.id,
            isTransportista: empresas.isTransportista,
            legalName: empresas.legalName,
          })
          .from(empresas)
          .where(eq(empresas.id, body.empresa_id))
          .limit(1);
        const empresa = empresaRows[0];
        if (!empresa) {
          record('empresa_no_encontrada');
          return c.json({ error: 'not_found', code: 'empresa_no_encontrada' }, 404);
        }
        if (!empresa.isTransportista) {
          record('empresa_no_transportista');
          return c.json({ error: 'unprocessable', code: 'empresa_no_transportista' }, 422);
        }

        const derivado = derivarUnidadDesdeTipoLegacy(body.vehicle_type);
        const violations = validarCoherenciaUnidadVehiculo({
          unitCategory: derivado.unitCategory,
          unitType: derivado.unitType,
          capacityKg: body.capacity_kg,
          curbWeightKg: body.curb_weight_kg ?? null,
          consumptionLPer100kmBaseline: null,
          fuelType: body.fuel_type ?? null,
        });
        const primera = violations[0];
        if (primera) {
          record(primera.code);
          return c.json(
            {
              error: 'tipo_categoria_incoherente',
              code: primera.code,
              violations,
            },
            422,
          );
        }

        // rls-allowlist: admin platform-wide query — protegido por requirePlatformAdmin.
        const ocupado = await opts.db
          .select({ id: vehicles.id })
          .from(vehicles)
          .where(eq(vehicles.teltonikaImei, body.teltonika_imei))
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
          .where(eq(pendingDevices.imei, body.teltonika_imei))
          .limit(1);
        const pending = pendingRows[0];
        if (pending?.status === 'aprobado' && pending.assignedToVehicleId !== null) {
          record('imei_en_uso');
          return c.json({ error: 'conflict', code: 'imei_en_uso' }, 409);
        }
        if (pending?.status === 'rechazado') {
          record('imei_rechazado');
          return c.json({ error: 'conflict', code: 'imei_rechazado' }, 409);
        }

        const reconciliacion = pending ? 'aprobado' : 'sin_registro';
        let created: { id: string; plate: string } | undefined;
        try {
          created = await opts.db.transaction(async (tx) => {
            // rls-allowlist: admin platform-wide — protegido por requirePlatformAdmin.
            const inserted = await tx
              .insert(vehicles)
              .values({
                empresaId: empresa.id,
                plate: body.plate,
                vehicleType: body.vehicle_type,
                unitCategory: derivado.unitCategory,
                unitType: derivado.unitType,
                bodyType: derivado.bodyType,
                capacityKg: body.capacity_kg,
                capacityM3: body.capacity_m3 ?? null,
                year: body.year ?? null,
                brand: body.brand ?? null,
                model: body.model ?? null,
                fuelType: body.fuel_type ?? null,
                curbWeightKg: body.curb_weight_kg ?? null,
                teltonikaImei: body.teltonika_imei,
              })
              .returning({ id: vehicles.id, plate: vehicles.plate });
            const row = inserted[0];
            if (!row) {
              return undefined;
            }
            if (pending && (pending.status === 'pendiente' || pending.status === 'reemplazado')) {
              await tx
                .update(pendingDevices)
                .set({
                  status: 'aprobado',
                  assignedToVehicleId: row.id,
                  assignedAt: new Date(),
                  assignedByUserId: admin.userContext.user.id,
                  updatedAt: new Date(),
                })
                .where(eq(pendingDevices.id, pending.id));
            }
            return row;
          });
        } catch (err) {
          if (pgErrorCode(err) === '23505') {
            const constraint = pgErrorConstraint(err) ?? '';
            const code = constraint.includes('patente') ? 'plate_duplicate' : 'imei_en_uso';
            record(code);
            return c.json({ error: 'conflict', code }, 409);
          }
          throw err;
        }

        if (!created) {
          opts.logger.error({ empresaId: empresa.id }, 'insert vehiculo no devolvió row');
          record('insert_failed');
          return c.json({ error: 'insert_failed' }, 500);
        }

        opts.logger.info(
          {
            vehicleId: created.id,
            empresaId: empresa.id,
            vehicleType: body.vehicle_type,
            derivedUnitCategory: derivado.unitCategory,
            derivedUnitType: derivado.unitType,
            derivedBodyType: derivado.bodyType,
            reconciliacion,
            asignadoPor: admin.adminEmail,
          },
          'vehículo habilitado con Teltonika desde platform-admin',
        );
        record(reconciliacion);

        return c.json(
          {
            ok: true,
            vehiculo_id: created.id,
            patente: created.plate,
            empresa_id: empresa.id,
            razon_social: empresa.legalName,
            teltonika_imei: body.teltonika_imei,
            reconciliacion,
          },
          201,
        );
      },
    );
  });

  return app;
}

function pgErrorField(err: unknown, field: 'code' | 'constraint'): string | undefined {
  if (typeof err !== 'object' || err === null) {
    return undefined;
  }
  if (field in err) {
    const value = Reflect.get(err, field);
    if (typeof value === 'string') {
      return value;
    }
  }
  if ('cause' in err) {
    return pgErrorField(err.cause, field);
  }
  return undefined;
}

function pgErrorCode(err: unknown): string | undefined {
  return pgErrorField(err, 'code');
}

function pgErrorConstraint(err: unknown): string | undefined {
  return pgErrorField(err, 'constraint');
}
