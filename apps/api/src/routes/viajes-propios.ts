import type { Logger } from '@booster-ai/logger';
import { crearViajePropioBodySchema, puedeAsignarViaje } from '@booster-ai/shared-schemas';
import { Hono } from 'hono';
import { ctxDeUserContext } from '../auth/capacidades.js';
import type { Db } from '../db/client.js';
import { zValidator } from '../lib/validation.js';
import { calcularMetricasEstimadas } from '../services/calcular-metricas-viaje.js';
import {
  EmpresaNoTransportistaError,
  GeneradorNoEncontradoError,
  GeneradorSinVinculoError,
  ViajePropioValidacionError,
  crearViajePropio,
} from '../services/crear-viaje-propio.js';

/**
 * BARH-24 — POST /viajes-propios
 * Alta de viaje propio del transportista (fuera del matching).
 */
export function createViajesPropiosRoutes(opts: {
  db: Db;
  logger: Logger;
  /** GCP project para Routes API (ADR-038); sin él, la tabla precomputada de Chile. */
  routesProjectId?: string | undefined;
}) {
  const app = new Hono();

  app.post('/', zValidator('json', crearViajePropioBodySchema), async (c) => {
    const userContext = c.get('userContext');
    if (!userContext) {
      return c.json({ error: 'internal_server_error' }, 500);
    }
    const active = userContext.activeMembership;
    if (!active) {
      return c.json({ error: 'no_active_empresa', code: 'no_active_empresa' }, 403);
    }
    if (!active.empresa.isTransportista) {
      return c.json({ error: 'not_a_carrier', code: 'not_a_carrier' }, 403);
    }
    if (active.empresa.status !== 'activa') {
      return c.json({ error: 'empresa_not_active', code: 'empresa_not_active' }, 403);
    }
    const ctx = ctxDeUserContext(userContext);
    if (!ctx || !puedeAsignarViaje(ctx)) {
      return c.json(
        { error: 'forbidden', code: 'capability_denied', capability: 'puedeAsignarViaje' },
        403,
      );
    }

    const body = c.req.valid('json');
    try {
      const r = await crearViajePropio({
        db: opts.db,
        logger: opts.logger,
        empresaTransportistaId: active.empresa.id,
        userId: userContext.user.id,
        input: body,
      });
      // `.specs/frente2-cierre` §3.3: el viaje propio nace con su huella
      // estimada, como un servicio del marketplace al aceptar la oferta
      // (spec viaje-propio §4.6). Sin camión todavía: estimación por defecto;
      // el cierre usa el camión de la asignación. Un fallo no revierte el alta.
      try {
        await calcularMetricasEstimadas({
          db: opts.db,
          logger: opts.logger,
          tripId: r.trip.id,
          vehicleId: null,
          ...(opts.routesProjectId ? { routesProjectId: opts.routesProjectId } : {}),
        });
      } catch (err) {
        opts.logger.error(
          { err, tripId: r.trip.id },
          'viaje propio creado sin métricas estimadas: el cierre no lo certificará',
        );
      }
      return c.json(
        {
          origen: 'propio_transportista',
          trip: {
            id: r.trip.id,
            tracking_code: r.trip.trackingCode,
            status: r.trip.status,
            origen_alta: r.trip.origenAlta,
          },
          assignment: {
            id: r.assignment.id,
            trip_request_id: r.assignment.tripId,
            status: r.assignment.status,
            agreed_price_clp: r.assignment.agreedPriceClp,
            accepted_at: r.assignment.acceptedAt.toISOString(),
          },
          ruta_id: r.rutaId,
        },
        201,
      );
    } catch (err) {
      if (err instanceof ViajePropioValidacionError) {
        return c.json(
          { error: 'validation_error', code: 'validation_error', issues: err.issues },
          400,
        );
      }
      if (err instanceof GeneradorNoEncontradoError) {
        return c.json(
          { error: 'generador_not_found', code: 'generador_not_found', empresa_id: err.empresaId },
          404,
        );
      }
      if (err instanceof GeneradorSinVinculoError) {
        return c.json(
          {
            error: 'generador_sin_vinculo',
            code: 'generador_sin_vinculo',
            empresa_id: err.empresaId,
          },
          403,
        );
      }
      if (err instanceof EmpresaNoTransportistaError) {
        return c.json({ error: 'not_a_carrier', code: 'not_a_carrier' }, 403);
      }
      throw err;
    }
  });

  return app;
}
