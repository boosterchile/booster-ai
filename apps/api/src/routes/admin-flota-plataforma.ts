import type { Logger } from '@booster-ai/logger';
import { and, asc, desc, eq, gt, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { asignacionConVehiculo } from '../db/configuracion-de-asignacion.js';
import {
  assignments,
  empresas,
  telemetryPoints,
  tripMetrics,
  trips,
  vehicles,
} from '../db/schema.js';
import { requirePlatformAdmin } from '../middleware/require-platform-admin.js';
import { getBusinessCounter } from '../observability/business-metrics.js';
import { setResultAttributes, withBusinessSpan } from '../observability/business-span.js';
import { ultimasPosicionesDeVehiculos } from '../services/ultimas-posiciones-vehiculos.js';

/**
 * La flota de todas las empresas, para el panel de plataforma
 * (`.specs/flota-plataforma`). Solo lectura.
 *
 *   GET /admin/plataforma/flota       todos los vehículos con su última posición
 *   GET /admin/plataforma/flota/:id   la ficha: vehículo, lectura de CAN, viajes y certificados
 *
 * La posición de los vehículos de un cliente es un dato sensible: cada
 * consulta queda en el log con el correo de quien la hizo.
 */

/** Tope de la lista. Si se alcanza, la respuesta lo dice con `truncada`. */
const MAX_VEHICULOS = 2000;
/** Ventana sobre la que se cuenta lo que el equipo envía por CAN. */
const VENTANA_CAN_DIAS = 3;
/** Viajes del vehículo que se leen para contar; la ficha muestra los más recientes. */
const MAX_VIAJES = 1000;
const VIAJES_EN_FICHA = 10;

const idSchema = z.string().uuid();
const consultas = getBusinessCounter('flota_plataforma_consultas_total');

const NIVELES = ['primario_verificable', 'secundario_modeled', 'secundario_default'] as const;

export function createAdminFlotaPlataformaRoutes(opts: { db: Db; logger: Logger }): Hono {
  const app = new Hono();

  app.get('/', async (c) => {
    const admin = requirePlatformAdmin(c);
    if (!admin.ok) {
      return admin.response;
    }
    return withBusinessSpan({ name: 'flota_plataforma.lista' }, async (span) => {
      // rls-allowlist: consulta de plataforma sobre todas las empresas — protegida por requirePlatformAdmin.
      const filas = await opts.db
        .select({
          id: vehicles.id,
          plate: vehicles.plate,
          empresaId: vehicles.empresaId,
          empresaNombre: empresas.legalName,
          vehicleType: vehicles.vehicleType,
          capacityKg: vehicles.capacityKg,
          vehicleStatus: vehicles.vehicleStatus,
          teltonika_imei: vehicles.teltonikaImei,
          teltonika_imei_espejo: vehicles.teltonikaImeiEspejo,
          fuenteCombustibleCan: vehicles.fuenteCombustibleCan,
        })
        .from(vehicles)
        .innerJoin(empresas, eq(empresas.id, vehicles.empresaId))
        .orderBy(asc(empresas.legalName), asc(vehicles.plate))
        .limit(MAX_VEHICULOS + 1);
      const truncada = filas.length > MAX_VEHICULOS;
      const visibles = truncada ? filas.slice(0, MAX_VEHICULOS) : filas;
      const posiciones = await ultimasPosicionesDeVehiculos(opts.db, visibles);

      const vehiculos = visibles.map((v) => {
        const punto = posiciones.get(v.id);
        const conCoordenada = punto && punto.latitude != null && punto.longitude != null;
        return {
          id: v.id,
          patente: v.plate,
          empresa: { id: v.empresaId, nombre: v.empresaNombre },
          tipo: v.vehicleType,
          capacidad_kg: v.capacityKg,
          estado: v.vehicleStatus,
          teltonika_imei: v.teltonika_imei ?? v.teltonika_imei_espejo,
          fuente_combustible_can: v.fuenteCombustibleCan,
          posicion: conCoordenada
            ? {
                latitud: Number.parseFloat(punto.latitude ?? ''),
                longitud: Number.parseFloat(punto.longitude ?? ''),
                velocidad_kmh: punto.speed_kmh,
                registrada_en: punto.timestamp_device.toISOString(),
                fuente: v.teltonika_imei
                  ? 'teltonika'
                  : v.teltonika_imei_espejo
                    ? 'espejo'
                    : 'movil',
              }
            : null,
        };
      });

      setResultAttributes(span, { 'booster.flota.vehiculos': vehiculos.length });
      consultas.add(1, { vista: 'lista' });
      opts.logger.info(
        { adminEmail: admin.adminEmail, vehiculos: vehiculos.length, truncada },
        'panel de plataforma: consulta de la flota de todas las empresas',
      );
      return c.json({ vehiculos, ...(truncada ? { truncada: true } : {}) });
    });
  });

  app.get('/:id', async (c) => {
    const admin = requirePlatformAdmin(c);
    if (!admin.ok) {
      return admin.response;
    }
    const noExiste = () => c.json({ error: 'vehiculo_not_found', code: 'vehiculo_not_found' }, 404);
    const id = idSchema.safeParse(c.req.param('id'));
    if (!id.success) {
      return noExiste();
    }
    const vehiculoId = id.data;

    return withBusinessSpan(
      { name: 'flota_plataforma.ficha', attributes: { 'booster.vehicle_id': vehiculoId } },
      async () => {
        // rls-allowlist: consulta de plataforma sobre cualquier empresa — protegida por requirePlatformAdmin.
        const [v] = await opts.db
          .select({
            id: vehicles.id,
            plate: vehicles.plate,
            empresaId: vehicles.empresaId,
            empresaNombre: empresas.legalName,
            empresaRut: empresas.rut,
            vehicleType: vehicles.vehicleType,
            brand: vehicles.brand,
            model: vehicles.model,
            year: vehicles.year,
            fuelType: vehicles.fuelType,
            capacityKg: vehicles.capacityKg,
            curbWeightKg: vehicles.curbWeightKg,
            consumptionLPer100kmBaseline: vehicles.consumptionLPer100kmBaseline,
            capacidadEstanqueL: vehicles.capacidadEstanqueL,
            vehicleStatus: vehicles.vehicleStatus,
            teltonika_imei: vehicles.teltonikaImei,
            teltonika_imei_espejo: vehicles.teltonikaImeiEspejo,
            fuenteCombustibleCan: vehicles.fuenteCombustibleCan,
          })
          .from(vehicles)
          .innerJoin(empresas, eq(empresas.id, vehicles.empresaId))
          .where(eq(vehicles.id, vehiculoId))
          .limit(1);
        if (!v) {
          return noExiste();
        }

        // Lo que el equipo envió de verdad en la ventana, contra lo configurado.
        let can: Record<string, unknown> | null = null;
        if (v.teltonika_imei) {
          const desde = new Date(Date.now() - VENTANA_CAN_DIAS * 24 * 60 * 60 * 1000);
          const con = (elemento: string) =>
            sql<number>`count(*) filter (where ${telemetryPoints.ioData} ? ${elemento})::int`;
          // rls-allowlist: telemetría del vehículo tomado por id — protegida por requirePlatformAdmin.
          const [lecturas] = await opts.db
            .select({
              puntos: sql<number>`count(*)::int`,
              con83: con('83'),
              con84: con('84'),
              con89: con('89'),
              ultima: sql<Date | null>`max(${telemetryPoints.timestampDevice})`,
            })
            .from(telemetryPoints)
            .where(
              and(
                eq(telemetryPoints.vehicleId, vehiculoId),
                gt(telemetryPoints.timestampDevice, desde),
              ),
            )
            .limit(1);
          const con83 = lecturas?.con83 ?? 0;
          const configurado83 = v.fuenteCombustibleCan === '83';
          const ultima = lecturas?.ultima ? new Date(lecturas.ultima) : null;
          can = {
            fuente_configurada: v.fuenteCombustibleCan,
            ventana_dias: VENTANA_CAN_DIAS,
            puntos: lecturas?.puntos ?? 0,
            con_combustible_83: con83,
            con_nivel_84: lecturas?.con84 ?? 0,
            con_nivel_89: lecturas?.con89 ?? 0,
            ultima_lectura_en: ultima ? ultima.toISOString() : null,
            aviso:
              con83 > 0 && !configurado83
                ? 'envia_83_sin_configurar'
                : con83 === 0 && configurado83
                  ? 'configurado_83_sin_lecturas'
                  : null,
          };
        }

        // rls-allowlist: viajes del vehículo tomado por id — protegida por requirePlatformAdmin.
        const delVehiculo = await opts.db
          .select({
            trackingCode: trips.trackingCode,
            status: assignments.status,
            deliveredAt: assignments.deliveredAt,
            certificationLevel: tripMetrics.certificationLevel,
            certificateIssuedAt: tripMetrics.certificateIssuedAt,
          })
          .from(assignments)
          .innerJoin(trips, eq(trips.id, assignments.tripId))
          .leftJoin(tripMetrics, eq(tripMetrics.tripId, assignments.tripId))
          .where(asignacionConVehiculo(vehiculoId))
          .orderBy(desc(assignments.acceptedAt))
          .limit(MAX_VIAJES);
        const entregados = delVehiculo.filter((a) => a.status === 'entregado');
        const certificados = Object.fromEntries(
          NIVELES.map((nivel) => [
            nivel,
            entregados.filter((a) => a.certificateIssuedAt && a.certificationLevel === nivel)
              .length,
          ]),
        );

        consultas.add(1, { vista: 'ficha' });
        opts.logger.info(
          { adminEmail: admin.adminEmail, vehiculoId, empresaId: v.empresaId },
          'panel de plataforma: consulta de la ficha de un vehículo',
        );
        return c.json({
          vehiculo: {
            id: v.id,
            patente: v.plate,
            empresa: { id: v.empresaId, nombre: v.empresaNombre, rut: v.empresaRut },
            tipo: v.vehicleType,
            marca: v.brand,
            modelo: v.model,
            anio: v.year,
            combustible: v.fuelType,
            capacidad_kg: v.capacityKg,
            peso_vacio_kg: v.curbWeightKg,
            consumo_l_por_100km_base:
              v.consumptionLPer100kmBaseline == null
                ? null
                : Number(v.consumptionLPer100kmBaseline),
            capacidad_estanque_l: v.capacidadEstanqueL,
            estado: v.vehicleStatus,
            teltonika_imei: v.teltonika_imei,
            teltonika_imei_espejo: v.teltonika_imei_espejo,
          },
          can,
          viajes: {
            entregados: entregados.length,
            en_curso: delVehiculo.filter((a) => a.status === 'asignado' || a.status === 'recogido')
              .length,
            certificados: {
              ...certificados,
              sin_certificado: entregados.filter((a) => !a.certificateIssuedAt).length,
            },
            ultimos: delVehiculo.slice(0, VIAJES_EN_FICHA).map((a) => ({
              codigo_seguimiento: a.trackingCode,
              estado: a.status,
              entregado_en: a.deliveredAt ? a.deliveredAt.toISOString() : null,
              nivel_certificacion: a.certificationLevel,
              certificado_emitido: a.certificateIssuedAt != null,
            })),
          },
        });
      },
    );
  });

  return app;
}
