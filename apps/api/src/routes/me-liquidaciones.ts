import type { Logger } from '@booster-ai/logger';
import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { config as appConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { assignments, facturasBoosterClp, liquidaciones, trips } from '../db/schema.js';
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
 *     `pagada_al_carrier`|`disputa`.
 *   - DTE meta (cuando aplica): folio, emitido_en, dte_status SII,
 *     pdf_url para descarga, provider que emitió.
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
        dteFolio: liquidaciones.dteFacturaBoosterFolio,
        dteEmitidoEn: liquidaciones.dteFacturaBoosterEmitidoEn,
        createdAt: liquidaciones.createdAt,
        // Meta del DTE viene de `facturas_booster_clp` (tabla canónica).
        facturaId: facturasBoosterClp.id,
        dteStatus: facturasBoosterClp.dteStatus,
        dtePdfUrl: facturasBoosterClp.dtePdfGcsUri,
        dteProvider: facturasBoosterClp.dteProvider,
        // Trip info para que el carrier identifique la liquidación.
        trackingCode: trips.trackingCode,
      })
      .from(liquidaciones)
      .leftJoin(facturasBoosterClp, eq(facturasBoosterClp.liquidacionId, liquidaciones.id))
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
        dte_folio: r.dteFolio,
        dte_emitido_en: r.dteEmitidoEn?.toISOString() ?? null,
        dte_status: r.dteStatus,
        dte_pdf_url: r.dtePdfUrl,
        dte_provider: r.dteProvider,
        creado_en: r.createdAt.toISOString(),
      })),
    });
  });

  return app;
}
