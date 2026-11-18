import type { Logger } from '@booster-ai/logger';
import {
  panelBoosterFleetSchema,
  programarMantencionSchema,
  realizarMantencionSchema,
} from '@booster-ai/shared-schemas';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { zValidator } from '../lib/validation.js';
import { getBusinessCounter } from '../observability/business-metrics.js';
import { setResultAttributes, withBusinessSpan } from '../observability/business-span.js';
import {
  armarPanelBoosterFleet,
  cerrarMantencion,
  programarMantencion,
} from '../services/booster-fleet.js';
import type { UserContext } from '../services/user-context.js';

/**
 * Booster Fleet — control de flota para el dueño del transportista.
 *
 *   GET  /booster-fleet
 *   POST /booster-fleet/mantenciones
 *   POST /booster-fleet/mantenciones/:id/realizar
 *   POST /booster-fleet/mantenciones/:id/cancelar
 *
 * Solo dueño o admin de una empresa transportista. El empresa_id sale de
 * la membresía activa.
 */

const ROLES = new Set(['dueno', 'admin']);

const idSchema = z.object({ id: z.string().uuid() });

const consultas = getBusinessCounter('booster_fleet_consultas_total');
const cambios = getBusinessCounter('booster_fleet_mantenciones_total');

export function createBoosterFleetRoutes(opts: {
  db: Db;
  logger: Logger;
  ahora?: () => Date;
  /** Puntos de telemetría por consulta del panel. Sale de la configuración. */
  presupuestoPuntos?: number | undefined;
}): Hono {
  const app = new Hono();
  const ahora = opts.ahora ?? (() => new Date());

  function requireDuenoAdmin(c: Context) {
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

  app.get('/', async (c) => {
    const auth = requireDuenoAdmin(c);
    if (!auth.ok) {
      consultas.add(1, { resultado: 'forbidden' });
      return auth.response;
    }
    return await withBusinessSpan(
      { name: 'booster_fleet.panel', attributes: { 'booster.empresa_id': auth.empresaId } },
      async (span) => {
        const panel = panelBoosterFleetSchema.parse(
          await armarPanelBoosterFleet({
            db: opts.db,
            logger: opts.logger,
            empresaId: auth.empresaId,
            ahora: ahora(),
            presupuestoPuntos: opts.presupuestoPuntos,
          }),
        );
        consultas.add(1, { resultado: panel.combustible.truncado ? 'truncado' : 'ok' });
        setResultAttributes(span, {
          'booster.fleet.vehiculos': panel.combustible.vehiculos.length,
          'booster.fleet.alertas_combustible': panel.combustible.con_alerta,
          'booster.fleet.combustible_truncado': panel.combustible.truncado,
          'booster.fleet.documentos_vehiculo': panel.documental.vehiculos_con_hallazgo,
          'booster.fleet.documentos_conductor': panel.documental.conductores_con_hallazgo,
          'booster.fleet.mantenciones_vencidas': panel.mantenciones.vencidas,
        });
        opts.logger.info(
          {
            empresaId: auth.empresaId,
            vehiculos: panel.combustible.vehiculos.length,
            alertas: panel.combustible.con_alerta,
          },
          'booster-fleet: panel',
        );
        return c.json(panel);
      },
    );
  });

  app.post('/mantenciones', zValidator('json', programarMantencionSchema), async (c) => {
    const auth = requireDuenoAdmin(c);
    if (!auth.ok) {
      cambios.add(1, { accion: 'programar', resultado: 'forbidden' });
      return auth.response;
    }
    const input = c.req.valid('json');
    return await withBusinessSpan(
      {
        name: 'booster_fleet.programar_mantencion',
        attributes: { 'booster.empresa_id': auth.empresaId },
      },
      async (span) => {
        const resultado = await programarMantencion({
          db: opts.db,
          logger: opts.logger,
          empresaId: auth.empresaId,
          input,
          ahora: ahora(),
        });
        if (!resultado.ok) {
          cambios.add(1, { accion: 'programar', resultado: resultado.code });
          setResultAttributes(span, { 'booster.fleet.resultado': resultado.code });
          return c.json({ error: 'not_found', code: resultado.code }, 404);
        }
        cambios.add(1, { accion: 'programar', resultado: 'ok' });
        setResultAttributes(span, {
          'booster.fleet.resultado': 'ok',
          'booster.fleet.mantencion_id': resultado.mantencion.id,
        });
        return c.json({ mantencion: resultado.mantencion }, 201);
      },
    );
  });

  app.post(
    '/mantenciones/:id/realizar',
    zValidator('param', idSchema),
    zValidator('json', realizarMantencionSchema),
    async (c) => {
      const auth = requireDuenoAdmin(c);
      if (!auth.ok) {
        cambios.add(1, { accion: 'realizar', resultado: 'forbidden' });
        return auth.response;
      }
      return await responderCierre(
        c,
        auth.empresaId,
        c.req.valid('param').id,
        'realizar',
        c.req.valid('json').kilometraje_realizado,
      );
    },
  );

  app.post('/mantenciones/:id/cancelar', zValidator('param', idSchema), async (c) => {
    const auth = requireDuenoAdmin(c);
    if (!auth.ok) {
      cambios.add(1, { accion: 'cancelar', resultado: 'forbidden' });
      return auth.response;
    }
    return await responderCierre(c, auth.empresaId, c.req.valid('param').id, 'cancelar', undefined);
  });

  async function responderCierre(
    c: Context,
    empresaId: string,
    mantencionId: string,
    accion: 'realizar' | 'cancelar',
    kilometrajeRealizado: number | undefined,
  ) {
    return await withBusinessSpan(
      {
        name: 'booster_fleet.cerrar_mantencion',
        attributes: { 'booster.empresa_id': empresaId, 'booster.fleet.accion': accion },
      },
      async (span) => {
        const resultado = await cerrarMantencion({
          db: opts.db,
          logger: opts.logger,
          empresaId,
          mantencionId,
          accion,
          kilometrajeRealizado,
          ahora: ahora(),
        });
        if (!resultado.ok) {
          cambios.add(1, { accion, resultado: resultado.code });
          setResultAttributes(span, { 'booster.fleet.resultado': resultado.code });
          const status = resultado.code === 'ya_cerrada' ? 409 : 404;
          return c.json({ error: resultado.code, code: resultado.code }, status);
        }
        cambios.add(1, { accion, resultado: 'ok' });
        setResultAttributes(span, { 'booster.fleet.resultado': 'ok' });
        return c.json({ mantencion: resultado.mantencion });
      },
    );
  }

  return app;
}
