/**
 * Endpoints carrier-side sobre assignments. Hoy solo:
 *
 *   - PATCH /:id/confirmar-entrega — POD del transportista (fallback al
 *     flujo canónico del shipper PATCH /trip-requests-v2/:id/confirmar-recepcion).
 *
 * El servicio confirmarEntregaViaje() centraliza la lógica; este file
 * es un wrapper thin para validar carrier-auth.
 */

import type { Logger } from '@booster-ai/logger';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Db } from '../db/client.js';
import { assignments } from '../db/schema.js';
import { confirmarEntregaViaje } from '../services/confirmar-entrega-viaje.js';
import type { EmitirCertificadoConfig } from '../services/emitir-certificado-viaje.js';

export function createAssignmentsRoutes(opts: {
  db: Db;
  logger: Logger;
  certConfig?: Partial<EmitirCertificadoConfig>;
}) {
  const app = new Hono();

  // biome-ignore lint/suspicious/noExplicitAny: hono Context generics complejos
  function requireCarrierAuth(c: Context<any, any, any>) {
    const userContext = c.get('userContext');
    if (!userContext) {
      opts.logger.error({ path: c.req.path }, '/assignments without userContext');
      return { ok: false as const, response: c.json({ error: 'unauthorized' }, 401) };
    }
    const active = userContext.activeMembership;
    if (!active) {
      return {
        ok: false as const,
        response: c.json({ error: 'no_active_empresa', code: 'no_active_empresa' }, 403),
      };
    }
    if (!active.empresa.isTransportista) {
      return {
        ok: false as const,
        response: c.json({ error: 'not_a_carrier', code: 'not_a_carrier' }, 403),
      };
    }
    if (active.empresa.status !== 'activa') {
      return {
        ok: false as const,
        response: c.json({ error: 'empresa_not_active', code: 'empresa_not_active' }, 403),
      };
    }
    return { ok: true as const, userContext, activeMembership: active };
  }

  // ---------------------------------------------------------------------
  // PATCH /:id/confirmar-entrega — carrier marca la carga como entregada.
  //
  // Es el flujo POD (Proof of Delivery) del transportista. Sirve como
  // fallback cuando el shipper no responde a tiempo. Idempotente.
  //
  // El servicio interno valida que el assignment pertenezca al carrier
  // (assignment.empresa_id === activeMembership.empresa.id) y dispara
  // el mismo lifecycle que el endpoint shipper.
  // ---------------------------------------------------------------------
  app.patch('/:id/confirmar-entrega', async (c) => {
    const auth = requireCarrierAuth(c);
    if (!auth.ok) {
      return auth.response;
    }
    const assignmentId = c.req.param('id');

    // Resolver tripId desde assignmentId. El servicio toma tripId como
    // identificador canónico — esto es el shim para que el carrier no
    // necesite saber el tripId directamente (su URL natural es por
    // assignment, no por trip).
    const rows = await opts.db
      .select({ tripId: assignments.tripId, empresaId: assignments.empresaId })
      .from(assignments)
      .where(eq(assignments.id, assignmentId))
      .limit(1);
    const row = rows[0];
    if (!row) {
      return c.json({ error: 'assignment_not_found', code: 'assignment_not_found' }, 404);
    }
    // Doble check de ownership (defensa en profundidad — el servicio
    // también valida).
    if (row.empresaId !== auth.activeMembership.empresa.id) {
      return c.json(
        { error: 'forbidden_owner_mismatch', code: 'forbidden_owner_mismatch' },
        403,
      );
    }

    const result = await confirmarEntregaViaje({
      db: opts.db,
      logger: opts.logger,
      tripId: row.tripId,
      source: 'carrier',
      actor: {
        empresaId: auth.activeMembership.empresa.id,
        userId: auth.userContext.user.id,
      },
      config: opts.certConfig ?? {},
    });

    if (!result.ok) {
      const statusCode =
        result.code === 'trip_not_found'
          ? 404
          : result.code === 'forbidden_owner_mismatch'
            ? 403
            : 409;
      return c.json(
        {
          error: result.code,
          code: result.code,
          ...(result.code === 'invalid_status' && result.currentStatus
            ? { current_status: result.currentStatus }
            : {}),
        },
        statusCode,
      );
    }

    return c.json({
      ok: true,
      already_delivered: result.alreadyDelivered,
      delivered_at: result.deliveredAt.toISOString(),
    });
  });

  return app;
}
