import type { Logger } from '@booster-ai/logger';
import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { config as appConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { assignments, liquidaciones, trips } from '../db/schema.js';
import type { UserContext } from '../services/user-context.js';

/**
 * GET /me/liquidaciones — lista de liquidaciones del carrier activo
 * (ADR-031 §4.1).
 *
 * Cada row incluye:
 *   - Identificadores: trip tracking_code, asignacion_id, liquidacion_id.
 *   - Importes: monto bruto, comisión, IVA, neto carrier, total factura
 *     Booster.
 *   - Status: `pending_consent`|`lista_para_dte`|`dte_emitido`|
 *     `pagada_al_carrier`|`disputa` (`dte_emitido` es legacy — ADR-069).
 *
 * **DTE deprecado (ADR-069, O-7 deprecación escalonada)**: Booster dejó
 * de emitir DTE (remoción Sovos). Los 5 campos `dte_*` se **mantienen en
 * el response como `null`** para backward-compat de PWAs en vuelo/caché,
 * pero ya no se pueblan (no se hace join a `facturas_booster_clp`). La
 * eliminación del contrato es una fase posterior tras confirmar cero
 * consumidores.
 *
 * Skip silencioso (200 con lista vacía) si `PRICING_V2_ACTIVATED=false`:
 * en entornos no-prod no hay liquidaciones, el carrier ve un mensaje
 * desde la UI cuando viene vacío.
 *
 * Si el flag está on pero la empresa activa no es transportista, 403.
 */
export function createMeLiquidacionesRoutes(opts: { db: Db; logger: Logger }) {
  const app = new Hono();

  app.get('/liquidaciones', async (c) => {
    if (!appConfig.PRICING_V2_ACTIVATED) {
      return c.json({ error: 'feature_disabled' }, 503);
    }
    const userContext = c.get('userContext') as UserContext | undefined;
    if (!userContext || !userContext.activeMembership) {
      return c.json({ error: 'no_active_empresa' }, 400);
    }
    const activeEmpresa = userContext.activeMembership.empresa;
    if (!activeEmpresa.isTransportista) {
      return c.json({ error: 'forbidden_no_transportista' }, 403);
    }
    const empresaCarrierId = activeEmpresa.id;

    const rows = await opts.db
      .select({
        liquidacionId: liquidaciones.id,
        asignacionId: liquidaciones.asignacionId,
        montoBrutoClp: liquidaciones.montoBrutoClp,
        comisionPct: liquidaciones.comisionPct,
        comisionClp: liquidaciones.comisionClp,
        ivaComisionClp: liquidaciones.ivaComisionClp,
        montoNetoCarrierClp: liquidaciones.montoNetoCarrierClp,
        totalFacturaBoosterClp: liquidaciones.totalFacturaBoosterClp,
        pricingMethodologyVersion: liquidaciones.pricingMethodologyVersion,
        status: liquidaciones.status,
        createdAt: liquidaciones.createdAt,
        // Trip info para que el carrier identifique la liquidación.
        trackingCode: trips.trackingCode,
      })
      .from(liquidaciones)
      .innerJoin(assignments, eq(assignments.id, liquidaciones.asignacionId))
      .innerJoin(trips, eq(trips.id, assignments.tripId))
      .where(eq(liquidaciones.empresaCarrierId, empresaCarrierId))
      .orderBy(desc(liquidaciones.createdAt))
      .limit(100);

    return c.json({
      liquidaciones: rows.map((r) => ({
        liquidacion_id: r.liquidacionId,
        asignacion_id: r.asignacionId,
        tracking_code: r.trackingCode,
        monto_bruto_clp: r.montoBrutoClp,
        comision_pct: Number(r.comisionPct),
        comision_clp: r.comisionClp,
        iva_comision_clp: r.ivaComisionClp,
        monto_neto_carrier_clp: r.montoNetoCarrierClp,
        total_factura_booster_clp: r.totalFacturaBoosterClp,
        pricing_methodology_version: r.pricingMethodologyVersion,
        status: r.status,
        // @deprecated ADR-069 / O-7 — Booster ya no emite DTE. Estos 5
        // campos se mantienen en el response devolviendo `null` para
        // backward-compat de PWAs en vuelo/caché; se removerán del schema
        // JSON en una fase posterior tras confirmar cero consumidores.
        dte_folio: null,
        dte_emitido_en: null,
        dte_status: null,
        dte_pdf_url: null,
        dte_provider: null,
        creado_en: r.createdAt.toISOString(),
      })),
    });
  });

  return app;
}
