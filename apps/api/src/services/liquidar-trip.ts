import type { Logger } from '@booster-ai/logger';
import {
  type MembershipTier,
  type TierSlug,
  calcularLiquidacion,
  calcularLiquidacionV3,
} from '@booster-ai/pricing-engine';
import { configuracionComercialSchema } from '@booster-ai/shared-schemas';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { pgErrorCode } from '../db/pg-error.js';
import {
  assignments,
  carrierMemberships,
  configuracionComercial,
  liquidaciones,
  membershipTiers,
  trips,
} from '../db/schema.js';
import { setResultAttributes, withBusinessSpan } from '../observability/business-span.js';

/**
 * Service orquestador de liquidación del trip (ADR-030 §8).
 *
 * Trigger v2 idealmente sería `confirmed_by_shipper` (ADR-007), pero
 * esa columna no existe todavía en el schema. Mientras tanto usamos
 * `deliveredAt` como proxy: cuando el carrier marca entregado, el trip
 * es liquidable. Cuando exista `confirmed_by_shipper`, mover el check.
 *
 * Es **idempotente** — múltiples llamadas con el mismo `assignmentId`
 * retornan `ya_liquidada` después del primer éxito (gracias al UNIQUE
 * constraint en `liquidaciones.asignacion_id`).
 *
 * Comportamiento por estado:
 *
 *   - `pricingV2Activated=false` → skip total, sin tocar BD
 *   - assignment no encontrado o sin `deliveredAt` → throw
 *   - carrier sin membership activa → skip (carrier nunca aceptó T&Cs v2)
 *   - membership activa pero `consent_terms_v2_aceptado_en IS NULL` →
 *     INSERT liquidación con `status='pending_consent'` (pendiente de
 *     consent del carrier)
 *   - todo OK → calcular + INSERT con `status='lista_para_dte'`
 *
 * Booster **no emite DTE** (ADR-069 supersede ADR-024): la emisión vía
 * Sovos fue removida. La liquidación cierra contablemente al INSERT; el
 * status `lista_para_dte` se conserva como valor legacy del enum pero ya
 * no dispara ninguna emisión. Las columnas `dte_*` quedan deprecadas.
 */

export interface LiquidarTripInput {
  db: Db;
  logger: Logger;
  assignmentId: string;
  pricingV2Activated: boolean;
  /**
   * ADR-079 §6 — con `true`, un viaje publicado con tasa congelada se
   * liquida v3 (comisión al generador). Un viaje publicado bajo v2 (sin
   * tasa congelada) sigue el camino v2: rige el contrato vigente al publicar.
   */
  pricingV3Activated?: boolean;
  /**
   * ADR-080 §5 — con `true`, una liquidación v3 se paga bajo mandato de
   * cobro (`modo_flujo='mandato_cobro'`). Una v2 siempre es `conector`: su
   * comisión se descuenta al transportista y no tiene precio del generador.
   */
  mandatoCobroActivated?: boolean;
}

export type LiquidarTripResult =
  | { status: 'skipped_flag_disabled' }
  | { status: 'skipped_no_membership' }
  | { status: 'pending_consent'; liquidacionId: string }
  | { status: 'liquidacion_creada'; liquidacionId: string }
  | { status: 'ya_liquidada'; liquidacionId: string };

export class AssignmentNotFoundError extends Error {
  constructor(public readonly assignmentId: string) {
    super(`Assignment ${assignmentId} not found`);
    this.name = 'AssignmentNotFoundError';
  }
}

export class AssignmentNotDeliveredError extends Error {
  constructor(public readonly assignmentId: string) {
    super(`Assignment ${assignmentId} sin deliveredAt — no liquidable`);
    this.name = 'AssignmentNotDeliveredError';
  }
}

export class TierNotFoundError extends Error {
  constructor(public readonly tierSlug: string) {
    super(`Tier ${tierSlug} no encontrado en BD (seed faltante?)`);
    this.name = 'TierNotFoundError';
  }
}

export async function liquidarTrip(input: LiquidarTripInput): Promise<LiquidarTripResult> {
  return await withBusinessSpan(
    {
      name: 'pricing.liquidar_trip',
      attributes: {
        'booster.assignment_id': input.assignmentId,
        'booster.pricing.flag_activated': input.pricingV2Activated,
      },
    },
    async (span) => {
      const result = await liquidarTripInner(input);
      setResultAttributes(span, {
        'booster.pricing.status': result.status,
        'booster.liquidacion_id': 'liquidacionId' in result ? result.liquidacionId : undefined,
      });
      return result;
    },
  );
}

async function liquidarTripInner(input: LiquidarTripInput): Promise<LiquidarTripResult> {
  const { db, logger, assignmentId, pricingV2Activated } = input;
  const pricingV3Activated = input.pricingV3Activated ?? false;

  if (!pricingV2Activated && !pricingV3Activated) {
    logger.debug({ assignmentId }, 'liquidarTrip: pricing v2 y v3 apagados, skip');
    return { status: 'skipped_flag_disabled' };
  }

  // (1) Lookup assignment + verificar confirmación.
  const asgRows = await db
    .select({
      id: assignments.id,
      empresaCarrierId: assignments.empresaId,
      agreedPriceClp: assignments.agreedPriceClp,
      deliveredAt: assignments.deliveredAt,
      tripId: assignments.tripId,
    })
    .from(assignments)
    .where(eq(assignments.id, assignmentId))
    .limit(1);
  const asg = asgRows[0];
  if (!asg) {
    throw new AssignmentNotFoundError(assignmentId);
  }
  if (!asg.deliveredAt) {
    throw new AssignmentNotDeliveredError(assignmentId);
  }

  // (1b) ADR-079 §6 — v3: si el viaje se publicó con tasa congelada.
  if (pricingV3Activated) {
    const v3 = await liquidarV3SiCorresponde({
      db,
      logger,
      assignmentId,
      asg,
      mandatoCobroActivated: input.mandatoCobroActivated ?? false,
    });
    if (v3) {
      return v3;
    }
  }
  if (!pricingV2Activated) {
    logger.debug({ assignmentId }, 'liquidarTrip: viaje sin tasa v3 y v2 apagado, skip');
    return { status: 'skipped_flag_disabled' };
  }

  // (2) Lookup membership activa del carrier.
  const memRows = await db
    .select({
      id: carrierMemberships.id,
      tierSlug: carrierMemberships.tierSlug,
      consentTermsV2AceptadoEn: carrierMemberships.consentTermsV2AceptadoEn,
    })
    .from(carrierMemberships)
    .where(
      and(
        eq(carrierMemberships.empresaId, asg.empresaCarrierId),
        eq(carrierMemberships.status, 'activa'),
      ),
    )
    .limit(1);
  const membership = memRows[0];
  if (!membership) {
    logger.info(
      { assignmentId, empresaId: asg.empresaCarrierId },
      'liquidarTrip: carrier sin membership activa, skip',
    );
    return { status: 'skipped_no_membership' };
  }

  // (3) Lookup tier (precision, comisión, etc).
  const tierRows = await db
    .select()
    .from(membershipTiers)
    .where(eq(membershipTiers.slug, membership.tierSlug))
    .limit(1);
  const tierRow = tierRows[0];
  if (!tierRow) {
    throw new TierNotFoundError(membership.tierSlug);
  }
  const tier: MembershipTier = {
    slug: tierRow.slug as TierSlug,
    displayName: tierRow.displayName,
    feeMonthlyClp: tierRow.feeMonthlyClp,
    commissionPct: Number(tierRow.commissionPct),
    matchingPriorityBoost: tierRow.matchingPriorityBoost,
    trustScoreBoost: tierRow.trustScoreBoost,
    deviceTeltonikaIncluded: tierRow.deviceTeltonikaIncluded,
  };

  // (4) Calcular liquidación (función pura).
  const liq = calcularLiquidacion({
    agreedPriceClp: asg.agreedPriceClp,
    tier,
  });

  const status = membership.consentTermsV2AceptadoEn ? 'lista_para_dte' : 'pending_consent';

  // (5) INSERT. UNIQUE en asignacion_id maneja la idempotencia.
  try {
    const inserted = await db
      .insert(liquidaciones)
      .values({
        asignacionId: assignmentId,
        empresaCarrierId: asg.empresaCarrierId,
        tierSlugAplicado: tier.slug,
        montoBrutoClp: liq.montoBrutoClp,
        comisionPct: liq.comisionPct.toFixed(2),
        comisionClp: liq.comisionClp,
        montoNetoCarrierClp: liq.montoNetoCarrierClp,
        ivaComisionClp: liq.ivaComisionClp,
        totalFacturaBoosterClp: liq.totalFacturaBoosterClp,
        pricingMethodologyVersion: liq.pricingMethodologyVersion,
        status,
      })
      .returning({ id: liquidaciones.id });

    const liquidacionId = inserted[0]?.id;
    if (!liquidacionId) {
      throw new Error('liquidarTrip: INSERT no devolvió id (estado inconsistente)');
    }

    logger.info(
      {
        assignmentId,
        liquidacionId,
        tierSlug: tier.slug,
        montoBruto: liq.montoBrutoClp,
        comision: liq.comisionClp,
        status,
      },
      'liquidarTrip: liquidación creada',
    );

    // ADR-069: Booster ya no emite DTE. La liquidación cierra acá; el
    // status `lista_para_dte` queda como estado contable final (legacy),
    // sin wire de emisión.
    return status === 'pending_consent'
      ? { status: 'pending_consent', liquidacionId }
      : { status: 'liquidacion_creada', liquidacionId };
  } catch (err) {
    // Si ya existe row por UNIQUE constraint en asignacion_id, retornar ya_liquidada.
    const existente = await liquidacionExistente(db, assignmentId, err);
    if (existente) {
      logger.info(
        { assignmentId, liquidacionId: existente },
        'liquidarTrip: ya liquidada (idempotente)',
      );
      return { status: 'ya_liquidada', liquidacionId: existente };
    }
    throw err;
  }
}

/**
 * ADR-079 §6 — liquidación v3: el transportista recibe `agreedPriceClp`
 * íntegro; el generador paga la comisión congelada al publicar + IVA de la
 * versión de configuración congelada. No exige membresía del transportista
 * (la membresía v2 vendía descuentos de comisión; en v3 no hay). Devuelve
 * null si el viaje no tiene tasa congelada (publicado bajo v2).
 */
async function liquidarV3SiCorresponde(opts: {
  db: Db;
  logger: Logger;
  assignmentId: string;
  asg: { empresaCarrierId: string; agreedPriceClp: number; tripId: string };
  mandatoCobroActivated: boolean;
}): Promise<LiquidarTripResult | null> {
  const { db, logger, assignmentId, asg } = opts;
  // rls-allowlist: liquidación post-entrega scoped por el tripId del assignment ya validado.
  const filas = await db
    .select({
      comisionPctAplicada: trips.comisionPctAplicada,
      configuracionComercialId: trips.configuracionComercialId,
      modalidadCarga: trips.modalidadCarga,
      configFila: configuracionComercial.config,
    })
    .from(trips)
    .leftJoin(configuracionComercial, eq(configuracionComercial.id, trips.configuracionComercialId))
    .where(eq(trips.id, asg.tripId))
    .limit(1);
  const viaje = filas[0];
  if (!viaje?.comisionPctAplicada || !viaje.configuracionComercialId || !viaje.configFila) {
    return null;
  }

  const liq = calcularLiquidacionV3({
    precioTransportistaClp: asg.agreedPriceClp,
    comisionPct: Number(viaje.comisionPctAplicada),
    // El JSONB se valida al leer: una fila corrupta no llega a pricing.
    ivaRate: configuracionComercialSchema.parse(viaje.configFila).impuestos.iva_pct / 100,
  });

  try {
    const inserted = await db
      .insert(liquidaciones)
      .values({
        asignacionId: assignmentId,
        empresaCarrierId: asg.empresaCarrierId,
        tierSlugAplicado: null,
        // Columnas v2 (NOT NULL) con su lectura v3: el transportista recibe
        // el bruto íntegro y la factura de Booster es la del generador.
        montoBrutoClp: liq.precioTransportistaClp,
        comisionPct: liq.comisionPct.toFixed(2),
        comisionClp: liq.comisionClp,
        montoNetoCarrierClp: liq.precioTransportistaClp,
        ivaComisionClp: liq.ivaComisionClp,
        totalFacturaBoosterClp: liq.totalFacturaGeneradorClp,
        pricingMethodologyVersion: liq.pricingMethodologyVersion,
        precioTransportistaClp: liq.precioTransportistaClp,
        precioGeneradorClp: liq.precioGeneradorClp,
        totalFacturaGeneradorClp: liq.totalFacturaGeneradorClp,
        modalidadCarga: viaje.modalidadCarga,
        configuracionComercialId: viaje.configuracionComercialId,
        modoFlujo: opts.mandatoCobroActivated ? 'mandato_cobro' : 'conector',
        // Estado contable final (valor legacy del enum; ADR-069).
        status: 'lista_para_dte',
      })
      .returning({ id: liquidaciones.id });
    const liquidacionId = inserted[0]?.id;
    if (!liquidacionId) {
      throw new Error('liquidarTrip v3: INSERT no devolvió id (estado inconsistente)');
    }
    logger.info(
      {
        assignmentId,
        liquidacionId,
        comisionPct: liq.comisionPct,
        comision: liq.comisionClp,
        modalidad: viaje.modalidadCarga,
      },
      'liquidarTrip: liquidación v3 creada',
    );
    return { status: 'liquidacion_creada', liquidacionId };
  } catch (err) {
    const existente = await liquidacionExistente(db, assignmentId, err);
    if (existente) {
      logger.info(
        { assignmentId, liquidacionId: existente },
        'liquidarTrip: ya liquidada (idempotente)',
      );
      return { status: 'ya_liquidada', liquidacionId: existente };
    }
    throw err;
  }
}

/**
 * Si `err` es una violación UNIQUE (23505; Drizzle deja el error de pg en
 * `cause`, así que el mensaje solo dice "Failed query"), el id ya liquidado.
 */
async function liquidacionExistente(
  db: Db,
  assignmentId: string,
  err: unknown,
): Promise<string | null> {
  const esUnique =
    pgErrorCode(err) === '23505' || (err instanceof Error && /unique|duplicate/i.test(err.message));
  if (!esUnique) {
    return null;
  }
  // rls-allowlist: dupe-check idempotente scoped por asignacionId ya validado (censo §2(1) / rls-viabilidad §2C)
  const existing = await db
    .select({ id: liquidaciones.id })
    .from(liquidaciones)
    .where(eq(liquidaciones.asignacionId, assignmentId))
    .limit(1);
  return existing[0]?.id ?? null;
}
