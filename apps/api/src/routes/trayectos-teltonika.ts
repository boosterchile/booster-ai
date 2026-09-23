import type { Logger } from '@booster-ai/logger';
import { zValidator } from '@hono/zod-validator';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { getBusinessCounter } from '../observability/business-metrics.js';
import { setResultAttributes, withBusinessSpan } from '../observability/business-span.js';
import { listarTrayectosTeltonika } from '../services/listar-trayectos-teltonika.js';
import type { UserContext } from '../services/user-context.js';

/**
 * Historial de trayectos Teltonika de la flota del transportista.
 *
 *   GET /trayectos-teltonika?combustible=con_dato|sin_dato
 *
 * Solo dueño|admin de una empresa transportista. El `empresa_id` sale de la
 * membresía activa. No está atado a una carga de Booster.
 */

const ROLES = new Set(['dueno', 'admin']);
const VENTANA_DEFAULT_MS = 7 * 24 * 60 * 60 * 1000;
const VENTANA_MAX_MS = 31 * 24 * 60 * 60 * 1000;

const querySchema = z.object({
  desde: z.string().datetime({ offset: true }).optional(),
  hasta: z.string().datetime({ offset: true }).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  page_size: z.coerce.number().int().min(1).max(50).optional(),
  combustible: z.enum(['con_dato', 'sin_dato']).optional(),
  vehiculo_id: z.string().uuid().optional(),
  /** Id de trayecto (`vehiculoId:inicio`) para incluirlo en la página del detalle. */
  detalle: z.string().min(1).max(180).optional(),
});

const consultas = getBusinessCounter('trayectos_teltonika_consultas_total');

export function createTrayectosTeltonikaRoutes(opts: { db: Db; logger: Logger }): Hono {
  const app = new Hono();

  function requireDuenoAdminTransportista(c: Context) {
    const userContext = c.get('userContext') as UserContext | undefined;
    if (!userContext) {
      return { ok: false as const, response: c.json({ error: 'unauthorized' }, 401) };
    }
    const activa = userContext.activeMembership;
    if (!activa?.membership.empresaId) {
      return {
        ok: false as const,
        response: c.json({ error: 'forbidden', code: 'no_active_empresa' }, 403),
      };
    }
    if (!activa.empresa.isTransportista) {
      return {
        ok: false as const,
        response: c.json({ error: 'forbidden', code: 'no_es_transportista' }, 403),
      };
    }
    if (!ROLES.has(activa.membership.role)) {
      return {
        ok: false as const,
        response: c.json({ error: 'forbidden', code: 'rol_no_autorizado' }, 403),
      };
    }
    return { ok: true as const, empresaId: activa.membership.empresaId };
  }

  app.get('/', zValidator('query', querySchema), async (c) => {
    const auth = requireDuenoAdminTransportista(c);
    if (!auth.ok) {
      consultas.add(1, { resultado: 'forbidden' });
      return auth.response;
    }

    const query = c.req.valid('query');
    const hasta = query.hasta ? new Date(query.hasta) : new Date();
    const desde = query.desde
      ? new Date(query.desde)
      : new Date(hasta.getTime() - VENTANA_DEFAULT_MS);
    if (!(desde.getTime() < hasta.getTime())) {
      return c.json({ error: 'unprocessable', code: 'ventana_invalida' }, 422);
    }
    if (hasta.getTime() - desde.getTime() > VENTANA_MAX_MS) {
      return c.json({ error: 'unprocessable', code: 'ventana_demasiado_amplia' }, 422);
    }

    const page = query.page ?? 1;
    const pageSize = query.page_size ?? 20;

    return await withBusinessSpan(
      {
        name: 'trayectos_teltonika.listar',
        attributes: { 'booster.empresa_id': auth.empresaId, 'booster.page': page },
      },
      async (span) => {
        const lista = await listarTrayectosTeltonika({
          db: opts.db,
          logger: opts.logger,
          empresaId: auth.empresaId,
          desde,
          hasta,
          page,
          pageSize,
          combustible: query.combustible ?? 'con_dato',
          vehiculoId: query.vehiculo_id,
          detalleId: query.detalle,
        });

        opts.logger.info(
          {
            empresaId: auth.empresaId,
            total: lista.total,
            totalConCombustible: lista.totalConCombustible,
            totalSinCombustible: lista.totalSinCombustible,
            combustible: lista.combustible,
            truncado: lista.truncado,
            vehiculosTeltonika: lista.vehiculosTeltonika,
            page,
          },
          'trayectos-teltonika: historial listado',
        );
        let resultado = 'ok';
        if (lista.cta === 'vincular_teltonika') {
          resultado = 'vacio';
        } else if (lista.truncado) {
          resultado = 'truncado';
        }
        consultas.add(1, { resultado });
        if (query.vehiculo_id) {
          span.setAttribute('booster.vehicle_id', query.vehiculo_id);
        }
        setResultAttributes(span, {
          'booster.trayectos.total': lista.total,
          'booster.trayectos.truncado': lista.truncado,
          'booster.trayectos.vehiculos': lista.vehiculosTeltonika,
          'booster.trayectos.con_combustible': lista.totalConCombustible,
          'booster.trayectos.sin_combustible': lista.totalSinCombustible,
        });

        return c.json(aJson(lista));
      },
    );
  });

  return app;
}

function aJson(lista: Awaited<ReturnType<typeof listarTrayectosTeltonika>>) {
  return {
    empresa_id: lista.empresaId,
    desde: lista.desde,
    hasta: lista.hasta,
    vehiculos_teltonika: lista.vehiculosTeltonika,
    truncado: lista.truncado,
    cta: lista.cta,
    cta_sensor: lista.ctaSensor,
    combustible: lista.combustible,
    page: lista.page,
    page_size: lista.pageSize,
    total: lista.total,
    total_con_combustible: lista.totalConCombustible,
    total_sin_combustible: lista.totalSinCombustible,
    vehiculos: lista.vehiculos.map((v) => ({
      vehiculo_id: v.vehiculoId,
      patente: v.patente,
      combustible: v.combustible,
    })),
    trayectos: lista.trayectos.map(serializarTrayecto),
    resumen_vehiculo: lista.resumenVehiculo
      ? {
          ultimo_trayecto: lista.resumenVehiculo.ultimo
            ? serializarTrayecto(lista.resumenVehiculo.ultimo)
            : null,
          recientes: lista.resumenVehiculo.recientes.map(serializarTrayecto),
          km_recientes: lista.resumenVehiculo.kmRecientes,
          litros_recientes: lista.resumenVehiculo.litrosRecientes,
          km_por_litro: lista.resumenVehiculo.kmPorLitro,
          cta_sensor: lista.resumenVehiculo.ctaSensor,
          alertas_total: lista.resumenVehiculo.alertasTotal,
          alerta_ultima: lista.resumenVehiculo.alertaUltima
            ? serializarTrayecto(lista.resumenVehiculo.alertaUltima)
            : null,
        }
      : null,
  };
}

function serializarTrayecto(
  t: Awaited<ReturnType<typeof listarTrayectosTeltonika>>['trayectos'][number],
) {
  return {
    id: t.id,
    vehiculo_id: t.vehiculoId,
    empresa_id: t.empresaId,
    patente: t.patente,
    inicio: t.inicio,
    fin: t.fin,
    distancia_km: t.distanciaKm,
    litros_iniciales: t.litrosIniciales,
    litros_finales: t.litrosFinales,
    km_por_litro: t.kmPorLitro,
    fuente_combustible: t.fuenteCombustible,
    litros_consumidos: t.litrosConsumidos,
    nivel_pct_inicial: t.nivelPctInicial,
    nivel_pct_final: t.nivelPctFinal,
    nota_combustible: t.notaCombustible,
    posible_robo_combustible: t.posibleRoboCombustible,
    posible_robo_hormiga: t.posibleRoboHormiga,
    event_lat: t.eventLat,
    event_lon: t.eventLon,
    sensor_combustible: t.sensorCombustible,
    cta_sensor: t.ctaSensor,
  };
}
