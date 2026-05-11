import {
  type DteEmitter,
  DteNotConfiguredError,
  DteProviderRejectedError,
  DteTransientError,
  DteValidationError,
  type FacturaInput,
} from '@booster-ai/dte-provider';
import type { Logger } from '@booster-ai/logger';
import { and, eq, sql } from 'drizzle-orm';
import { config as appConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { empresas, facturasBoosterClp, liquidaciones } from '../db/schema.js';
import { getDteEmitter } from './dte-emitter-factory.js';

/**
 * ADR-024 + ADR-031 §4.1 — emite el DTE Tipo 33 (factura comisión
 * Booster al carrier) asociado a una liquidación.
 *
 * Flow:
 *   1. Lookup liquidación + empresa carrier (receptor).
 *   2. Skip silencioso si:
 *      - flag PRICING_V2_ACTIVATED off → no emite.
 *      - liquidación ya tiene DTE folio asignado → idempotente, return ok.
 *      - liquidación status != `lista_para_dte` → no aplica.
 *      - adapter es null (DTE_PROVIDER=disabled o sin creds Sovos).
 *   3. INSERT row en `facturas_booster_clp` con tipo='comision_trip'
 *      y dte_folio=NULL (placeholder previo al call al provider).
 *      Race-safety: si ya existe row por la misma liquidacion_id +
 *      tipo='comision_trip', se reusa (idempotente).
 *   4. Llama `adapter.emitFactura()` con el payload canónico.
 *   5. UPDATE factura con dte_folio + dte_emitida_en + pdf_url +
 *      provider + status='aceptado' (Sovos no devuelve status SII
 *      en emit; queryStatus reconcilia después).
 *   6. UPDATE liquidación con dte_factura_booster_folio +
 *      dte_factura_booster_emitido_en + status='dte_emitido'.
 *
 * **Idempotente**: re-correr post-éxito no re-emite (los UPDATEs son
 * no-op porque la liquidación ya tiene folio).
 *
 * **Fire-and-forget compatible**: errores transient se loggean WARN y
 * retornan `{ status: 'transient_error' }` — el caller (liquidar-trip)
 * no propaga, espera el cron de reemisión.
 */

export interface EmitirDteLiquidacionInput {
  db: Db;
  logger: Logger;
  liquidacionId: string;
}

export type EmitirDteLiquidacionResult =
  | { status: 'skipped'; reason: 'flag_disabled' | 'no_adapter' | 'liquidacion_no_aplicable' }
  | { status: 'ya_emitido'; folio: string }
  | { status: 'liquidacion_not_found' }
  | { status: 'empresa_carrier_not_found' }
  | { status: 'validation_error'; message: string }
  | { status: 'transient_error'; message: string }
  | { status: 'provider_rejected'; providerCode: string; message: string }
  | {
      status: 'emitido';
      folio: string;
      facturaId: string;
      providerTrackId: string | undefined;
    };

export async function emitirDteLiquidacion(
  input: EmitirDteLiquidacionInput,
): Promise<EmitirDteLiquidacionResult> {
  const { db, logger, liquidacionId } = input;

  if (!appConfig.PRICING_V2_ACTIVATED) {
    logger.debug({ liquidacionId }, 'emitirDteLiquidacion: PRICING_V2_ACTIVATED=false, skip');
    return { status: 'skipped', reason: 'flag_disabled' };
  }

  const adapter = getDteEmitter(logger);
  if (!adapter) {
    logger.debug({ liquidacionId }, 'emitirDteLiquidacion: no hay adapter activo, skip');
    return { status: 'skipped', reason: 'no_adapter' };
  }

  // (1) Lookup liquidación + carrier.
  const liqRows = await db
    .select({
      id: liquidaciones.id,
      asignacionId: liquidaciones.asignacionId,
      empresaCarrierId: liquidaciones.empresaCarrierId,
      comisionClp: liquidaciones.comisionClp,
      ivaComisionClp: liquidaciones.ivaComisionClp,
      totalFacturaBoosterClp: liquidaciones.totalFacturaBoosterClp,
      status: liquidaciones.status,
      dteFacturaBoosterFolio: liquidaciones.dteFacturaBoosterFolio,
      pricingMethodologyVersion: liquidaciones.pricingMethodologyVersion,
    })
    .from(liquidaciones)
    .where(eq(liquidaciones.id, liquidacionId))
    .limit(1);
  const liq = liqRows[0];
  if (!liq) {
    return { status: 'liquidacion_not_found' };
  }

  if (liq.dteFacturaBoosterFolio) {
    logger.info(
      { liquidacionId, folio: liq.dteFacturaBoosterFolio },
      'emitirDteLiquidacion: liquidación ya tiene DTE, idempotente',
    );
    return { status: 'ya_emitido', folio: liq.dteFacturaBoosterFolio };
  }

  if (liq.status !== 'lista_para_dte') {
    logger.debug(
      { liquidacionId, currentStatus: liq.status },
      'emitirDteLiquidacion: liquidación no está lista_para_dte, skip',
    );
    return { status: 'skipped', reason: 'liquidacion_no_aplicable' };
  }

  const carrierRows = await db
    .select({
      id: empresas.id,
      legalName: empresas.legalName,
      rut: empresas.rut,
      addressStreet: empresas.addressStreet,
      addressCity: empresas.addressCity,
    })
    .from(empresas)
    .where(eq(empresas.id, liq.empresaCarrierId))
    .limit(1);
  const carrier = carrierRows[0];
  if (!carrier) {
    return { status: 'empresa_carrier_not_found' };
  }

  // (2) INSERT factura placeholder (o reusar si existe).
  // rls-allowlist: factura platform-wide — protegido por flag.
  const facturaExistingRows = await db
    .select({
      id: facturasBoosterClp.id,
      dteFolio: facturasBoosterClp.dteFolio,
    })
    .from(facturasBoosterClp)
    .where(
      and(
        eq(facturasBoosterClp.liquidacionId, liquidacionId),
        eq(facturasBoosterClp.tipo, 'comision_trip'),
      ),
    )
    .limit(1);
  let facturaId: string;
  if (facturaExistingRows[0]) {
    facturaId = facturaExistingRows[0].id;
    if (facturaExistingRows[0].dteFolio) {
      // Race: alguien más emitió. Reconciliar liquidación y retornar.
      await syncLiquidacionFolio(db, liquidacionId, facturaExistingRows[0].dteFolio);
      return { status: 'ya_emitido', folio: facturaExistingRows[0].dteFolio };
    }
  } else {
    const ventInDays = 30;
    const venceEn = new Date(Date.now() + ventInDays * 24 * 60 * 60 * 1000);
    // rls-allowlist: factura platform-wide — protegido por flag.
    const inserted = await db
      .insert(facturasBoosterClp)
      .values({
        empresaDestinoId: carrier.id,
        tipo: 'comision_trip',
        liquidacionId: liquidacionId,
        subtotalClp: liq.comisionClp,
        ivaClp: liq.ivaComisionClp,
        totalClp: liq.totalFacturaBoosterClp,
        dteTipo: 33,
        status: 'pending_dte',
        venceEn,
      })
      .returning({ id: facturasBoosterClp.id });
    const created = inserted[0];
    if (!created) {
      throw new Error('emitirDteLiquidacion: INSERT factura no devolvió id');
    }
    facturaId = created.id;
  }

  // (3) Build payload + llamar adapter.
  const fechaHoy = new Date().toISOString().slice(0, 10);
  const facturaInput: FacturaInput = {
    emisor: {
      rut: appConfig.BOOSTER_RUT,
      razonSocial: appConfig.BOOSTER_RAZON_SOCIAL,
      giro: appConfig.BOOSTER_GIRO,
      direccion: appConfig.BOOSTER_DIRECCION,
      comuna: appConfig.BOOSTER_COMUNA,
    },
    receptor: {
      rut: carrier.rut,
      razonSocial: carrier.legalName,
      ...(carrier.addressStreet ? { direccion: carrier.addressStreet } : {}),
      ...(carrier.addressCity ? { comuna: carrier.addressCity } : {}),
    },
    fechaEmision: fechaHoy,
    items: [
      {
        descripcion: `Comisión Booster sobre asignación ${liq.asignacionId} (${liq.pricingMethodologyVersion})`,
        montoNetoClp: liq.comisionClp,
        exento: false,
      },
    ],
  };

  let dteResult: Awaited<ReturnType<DteEmitter['emitFactura']>>;
  try {
    dteResult = await adapter.emitFactura(facturaInput);
  } catch (err) {
    return handleProviderError(err, logger, { liquidacionId, facturaId });
  }

  // (4) UPDATE factura con folio + meta.
  // rls-allowlist: factura platform-wide — protegido por flag.
  await db
    .update(facturasBoosterClp)
    .set({
      dteFolio: dteResult.folio,
      dteEmitidaEn: new Date(dteResult.emitidoEn),
      ...(dteResult.pdfUrl ? { dtePdfGcsUri: dteResult.pdfUrl } : {}),
      dteProvider: appConfig.DTE_PROVIDER,
      ...(dteResult.providerTrackId ? { dteProviderTrackId: dteResult.providerTrackId } : {}),
      // Sovos no devuelve status SII en emit — el cron de reconciliación
      // hace queryStatus después. Default initial: 'en_proceso'.
      dteStatus: 'en_proceso',
      status: 'dte_emitido',
      updatedAt: sql`now()`,
    })
    .where(eq(facturasBoosterClp.id, facturaId));

  // (5) UPDATE liquidación.
  await syncLiquidacionFolio(db, liquidacionId, dteResult.folio);

  logger.info(
    {
      liquidacionId,
      facturaId,
      folio: dteResult.folio,
      provider: appConfig.DTE_PROVIDER,
      montoTotal: dteResult.montoTotalClp,
    },
    'emitirDteLiquidacion: DTE emitido',
  );

  return {
    status: 'emitido',
    folio: dteResult.folio,
    facturaId,
    providerTrackId: dteResult.providerTrackId,
  };
}

async function syncLiquidacionFolio(db: Db, liquidacionId: string, folio: string): Promise<void> {
  await db
    .update(liquidaciones)
    .set({
      dteFacturaBoosterFolio: folio,
      dteFacturaBoosterEmitidoEn: new Date(),
      status: 'dte_emitido',
      updatedAt: sql`now()`,
    })
    .where(eq(liquidaciones.id, liquidacionId));
}

function handleProviderError(
  err: unknown,
  logger: Logger,
  ctx: { liquidacionId: string; facturaId: string },
): EmitirDteLiquidacionResult {
  if (err instanceof DteNotConfiguredError) {
    logger.warn({ err, ...ctx }, 'emitirDteLiquidacion: adapter not configured at call time');
    return { status: 'skipped', reason: 'no_adapter' };
  }
  if (err instanceof DteValidationError) {
    logger.error({ err, ...ctx }, 'emitirDteLiquidacion: payload validation falló');
    return { status: 'validation_error', message: err.message };
  }
  if (err instanceof DteTransientError) {
    logger.warn({ err, ...ctx }, 'emitirDteLiquidacion: transient — re-emisión vía cron');
    return { status: 'transient_error', message: err.message };
  }
  if (err instanceof DteProviderRejectedError) {
    logger.error(
      { err, providerCode: err.providerCode, ...ctx },
      'emitirDteLiquidacion: provider rechazó — escalar a admin',
    );
    return {
      status: 'provider_rejected',
      providerCode: err.providerCode,
      message: err.message,
    };
  }
  // Unknown error — propagamos para que el orchestrator lo logueé como
  // unhandled. Acá NO clasificamos como transient porque puede ser bug.
  throw err;
}
