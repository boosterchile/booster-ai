import type { Logger } from '@booster-ai/logger';
import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { config as appConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { adelantosCarrier } from '../db/schema.js';
import { cobraHoy, cotizarCobraHoy } from '../services/cobra-hoy.js';
import type { UserContext } from '../services/user-context.js';

/**
 * Rutas de "Booster Cobra Hoy" (ADR-029 + ADR-032).
 *
 *   - GET  /assignments/:id/cobra-hoy/cotizacion → preview de tarifa
 *   - POST /assignments/:id/cobra-hoy            → solicitar adelanto
 *   - GET  /me/cobra-hoy/historial               → lista de adelantos del
 *                                                   carrier activo
 *
 * Los 3 endpoints requieren `userContext` (firebaseAuth + userContextMiddleware).
 *
 * Feature flag: si `FACTORING_V1_ACTIVATED=false`, los endpoints
 * responden 503 con `feature_disabled`. La UI lee esto para esconder
 * el botón.
 */

export function createCobraHoyAssignmentsRoutes(opts: { db: Db; logger: Logger }) {
  const app = new Hono();

  app.get('/:id/cobra-hoy/cotizacion', async (c) => {
    if (!appConfig.FACTORING_V1_ACTIVATED) {
      return c.json({ error: 'feature_disabled' }, 503);
    }
    const userContext = c.get('userContext') as UserContext | undefined;
    if (!userContext || !userContext.activeMembership) {
      return c.json({ error: 'no_active_empresa' }, 400);
    }
    const empresaCarrierId = userContext.activeMembership.empresa.id;
    const asignacionId = c.req.param('id');
    const plazoQuery = c.req.query('plazo_dias');
    const plazoDiasShipper = plazoQuery ? Number(plazoQuery) : undefined;
    if (
      plazoDiasShipper !== undefined &&
      (!Number.isInteger(plazoDiasShipper) || plazoDiasShipper <= 0)
    ) {
      return c.json({ error: 'invalid_plazo' }, 400);
    }

    const result = await cotizarCobraHoy({
      db: opts.db,
      asignacionId,
      empresaCarrierId,
      ...(plazoDiasShipper !== undefined ? { plazoDiasShipper } : {}),
    });

    if (result.status === 'assignment_not_found') {
      return c.json({ error: 'assignment_not_found' }, 404);
    }
    if (result.status === 'forbidden_owner_mismatch') {
      return c.json({ error: 'forbidden_owner_mismatch' }, 403);
    }
    if (result.status === 'no_liquidacion') {
      return c.json({ error: 'no_liquidacion' }, 409);
    }
    return c.json({
      monto_neto_clp: result.montoNetoClp,
      plazo_dias_shipper: result.plazoDiasShipper,
      tarifa_pct: result.tarifaPct,
      tarifa_clp: result.tarifaClp,
      monto_adelantado_clp: result.montoAdelantadoClp,
    });
  });

  app.post('/:id/cobra-hoy', async (c) => {
    if (!appConfig.FACTORING_V1_ACTIVATED) {
      return c.json({ error: 'feature_disabled' }, 503);
    }
    const userContext = c.get('userContext') as UserContext | undefined;
    if (!userContext || !userContext.activeMembership) {
      return c.json({ error: 'no_active_empresa' }, 400);
    }
    const empresaCarrierId = userContext.activeMembership.empresa.id;
    const asignacionId = c.req.param('id');

    const result = await cobraHoy({
      db: opts.db,
      logger: opts.logger,
      asignacionId,
      empresaCarrierId,
      factoringV1Activated: appConfig.FACTORING_V1_ACTIVATED,
    });

    switch (result.status) {
      case 'skipped_flag_disabled':
        return c.json({ error: 'feature_disabled' }, 503);
      case 'assignment_not_found':
        return c.json({ error: 'assignment_not_found' }, 404);
      case 'assignment_not_delivered':
        return c.json(
          { error: 'assignment_not_delivered', message: 'El viaje aún no fue marcado entregado' },
          409,
        );
      case 'no_liquidacion':
        return c.json(
          { error: 'no_liquidacion', message: 'La liquidación del viaje no existe todavía' },
          409,
        );
      case 'forbidden_owner_mismatch':
        return c.json({ error: 'forbidden_owner_mismatch' }, 403);
      case 'shipper_no_aprobado':
        return c.json({ error: 'shipper_no_aprobado', message: result.motivo }, 422);
      case 'limite_exposicion_excedido':
        return c.json(
          {
            error: 'limite_exposicion_excedido',
            limit_clp: result.limitClp,
            exposicion_clp: result.exposicionClp,
          },
          422,
        );
      case 'ya_solicitado':
        return c.json({ ok: true, already_requested: true, adelanto_id: result.adelantoId }, 200);
      case 'solicitado':
        return c.json(
          {
            ok: true,
            already_requested: false,
            adelanto_id: result.adelantoId,
            tarifa_pct: result.tarifaPct,
            tarifa_clp: result.tarifaClp,
            monto_adelantado_clp: result.montoAdelantadoClp,
          },
          201,
        );
    }
  });

  return app;
}

/**
 * Decide qué mensaje del admin se expone al carrier en el historial,
 * según el estado del adelanto. Pure: facilita test unitario sin BD.
 *
 *   - `rechazado` / `cancelado` → primero `rechazoMotivo` (campo
 *     semánticamente acotado), si no hay → última línea de `notas_admin`.
 *   - `mora` → última línea de `notas_admin` (típicamente la
 *     auto-mora del cron).
 *   - Otros estados → null (no surfaced para preservar privacidad
 *     operativa: admins pueden dejar notas internas que el carrier
 *     no debería ver hasta que se "cierre" su solicitud).
 */
export function buildNotaVisible(
  status: string,
  rechazoMotivo: string | null,
  notasAdmin: string | null,
): string | null {
  if (status !== 'rechazado' && status !== 'cancelado' && status !== 'mora') {
    return null;
  }
  if (rechazoMotivo && (status === 'rechazado' || status === 'cancelado')) {
    return rechazoMotivo;
  }
  if (!notasAdmin) {
    return null;
  }
  // Última línea no vacía (las notas se appenden con \n al final).
  const lines = notasAdmin.split('\n').filter((l) => l.trim() !== '');
  const last = lines[lines.length - 1];
  if (!last) {
    return null;
  }
  // Strip tag `[ISO email]` del prefijo: el carrier no necesita ver el
  // email del operador ni la marca temporal — esa info queda en logs
  // para auditoría.
  return last.replace(/^\[[^\]]+\]\s*/, '').trim() || null;
}

export function createCobraHoyMeRoutes(opts: { db: Db; logger: Logger }) {
  const app = new Hono();

  app.get('/cobra-hoy/historial', async (c) => {
    if (!appConfig.FACTORING_V1_ACTIVATED) {
      return c.json({ error: 'feature_disabled' }, 503);
    }
    const userContext = c.get('userContext') as UserContext | undefined;
    if (!userContext || !userContext.activeMembership) {
      return c.json({ error: 'no_active_empresa' }, 400);
    }
    const empresaCarrierId = userContext.activeMembership.empresa.id;
    const rows = await opts.db
      .select({
        id: adelantosCarrier.id,
        asignacionId: adelantosCarrier.asignacionId,
        montoNetoClp: adelantosCarrier.montoNetoClp,
        plazoDiasShipper: adelantosCarrier.plazoDiasShipper,
        tarifaPct: adelantosCarrier.tarifaPct,
        tarifaClp: adelantosCarrier.tarifaClp,
        montoAdelantadoClp: adelantosCarrier.montoAdelantadoClp,
        status: adelantosCarrier.status,
        desembolsadoEn: adelantosCarrier.desembolsadoEn,
        rechazoMotivo: adelantosCarrier.rechazoMotivo,
        notasAdmin: adelantosCarrier.notasAdmin,
        createdAt: adelantosCarrier.createdAt,
      })
      .from(adelantosCarrier)
      .where(eq(adelantosCarrier.empresaCarrierId, empresaCarrierId))
      .orderBy(desc(adelantosCarrier.createdAt))
      .limit(100);

    return c.json({
      adelantos: rows.map((r) => ({
        id: r.id,
        asignacion_id: r.asignacionId,
        monto_neto_clp: r.montoNetoClp,
        plazo_dias_shipper: r.plazoDiasShipper,
        tarifa_pct: Number(r.tarifaPct),
        tarifa_clp: r.tarifaClp,
        monto_adelantado_clp: r.montoAdelantadoClp,
        status: r.status,
        desembolsado_en: r.desembolsadoEn?.toISOString() ?? null,
        creado_en: r.createdAt.toISOString(),
        // ADR-032 — el carrier solo ve mensajes para estados donde la
        // explicación cierra el loop UX: rechazado, cancelado, mora.
        // Para otros estados, los admins pueden dejar notas internas que
        // NO deben filtrarse al carrier (privacidad operativa).
        nota_visible: buildNotaVisible(r.status, r.rechazoMotivo, r.notasAdmin),
      })),
    });
  });

  return app;
}
