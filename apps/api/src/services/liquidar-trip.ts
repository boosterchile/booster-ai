import type { Logger } from '@booster-ai/logger';
import {
  type MembershipTier,
  type TierSlug,
  calcularLiquidacion,
} from '@booster-ai/pricing-engine';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { assignments, carrierMemberships, liquidaciones, membershipTiers } from '../db/schema.js';

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
 *     consent; emisión DTE bloqueada)
 *   - todo OK → calcular + INSERT con `status='lista_para_dte'`
 *
 * NO emite DTE directamente — un job separado `emitir-dte-pendientes`
 * lee las liquidaciones en `lista_para_dte` y llama Sovos.
 */

export interface LiquidarTripInput {
  db: Db;
  logger: Logger;
  assignmentId: string;
  pricingV2Activated: boolean;
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
  const { db, logger, assignmentId, pricingV2Activated } = input;

  if (!pricingV2Activated) {
    logger.debug({ assignmentId }, 'liquidarTrip: PRICING_V2_ACTIVATED=false, skip');
    return { status: 'skipped_flag_disabled' };
  }

  // (1) Lookup assignment + verificar confirmación.
  const asgRows = await db
    .select({
      id: assignments.id,
      empresaCarrierId: assignments.empresaId,
      agreedPriceClp: assignments.agreedPriceClp,
      deliveredAt: assignments.deliveredAt,
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

    return status === 'pending_consent'
      ? { status: 'pending_consent', liquidacionId }
      : { status: 'liquidacion_creada', liquidacionId };
  } catch (err) {
    // Si ya existe row por UNIQUE constraint en asignacion_id, retornar ya_liquidada.
    if (err instanceof Error && /unique|duplicate/i.test(err.message)) {
      const existing = await db
        .select({ id: liquidaciones.id })
        .from(liquidaciones)
        .where(eq(liquidaciones.asignacionId, assignmentId))
        .limit(1);
      const existingId = existing[0]?.id;
      if (existingId) {
        logger.info(
          { assignmentId, liquidacionId: existingId },
          'liquidarTrip: ya liquidada (idempotente)',
        );
        return { status: 'ya_liquidada', liquidacionId: existingId };
      }
    }
    throw err;
  }
}
