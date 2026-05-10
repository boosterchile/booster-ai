import { calcularTarifaProntoPago } from '@booster-ai/factoring-engine';
import type { Logger } from '@booster-ai/logger';
import { and, eq, gt, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  adelantosCarrier,
  assignments,
  liquidaciones,
  shipperCreditDecisions,
  trips,
} from '../db/schema.js';

/**
 * Service orquestador de "Booster Cobra Hoy" (ADR-029 + ADR-032).
 *
 * Cotización: función pura que no toca BD (puede usarse para preview
 * antes del POST).
 *
 * Solicitud: idempotente vía UNIQUE constraint en `asignacion_id`. Si
 * ya hay adelanto para esta asignación, retorna `ya_solicitado` con
 * el id del adelanto existente.
 *
 * Flow:
 *   1. Flag check
 *   2. Lookup assignment + trip + liquidacion
 *   3. Validar shipper credit decision vigente + approved
 *   4. Validar exposición no excedida
 *   5. Calcular tarifa pura
 *   6. INSERT adelantos_carrier status='solicitado'
 *
 * Partner integration real (Toctoc/Mafin/etc) NO es responsabilidad
 * de este service — un job separado o webhook del partner avanza
 * adelantos de 'solicitado' → 'aprobado' → 'desembolsado'.
 */

export interface CobraHoyInput {
  db: Db;
  logger: Logger;
  asignacionId: string;
  empresaCarrierId: string;
  factoringV1Activated: boolean;
}

export type CobraHoyResult =
  | { status: 'skipped_flag_disabled' }
  | { status: 'assignment_not_found' }
  | { status: 'assignment_not_delivered' }
  | { status: 'no_liquidacion' }
  | { status: 'forbidden_owner_mismatch' }
  | { status: 'shipper_no_aprobado'; motivo: string }
  | { status: 'limite_exposicion_excedido'; limitClp: number; exposicionClp: number }
  | { status: 'ya_solicitado'; adelantoId: string }
  | {
      status: 'solicitado';
      adelantoId: string;
      tarifaPct: number;
      tarifaClp: number;
      montoAdelantadoClp: number;
    };

export interface CotizacionInput {
  db: Db;
  asignacionId: string;
  empresaCarrierId: string;
  plazoDiasShipper?: number;
}

export type CotizacionResult =
  | { status: 'assignment_not_found' }
  | { status: 'no_liquidacion' }
  | { status: 'forbidden_owner_mismatch' }
  | {
      status: 'ok';
      montoNetoClp: number;
      plazoDiasShipper: number;
      tarifaPct: number;
      tarifaClp: number;
      montoAdelantadoClp: number;
    };

/**
 * Plazo de pago default del shipper, en días, cuando el trip no lo
 * declara explícitamente. Configurable cuando el modelo evolucione a
 * negociación shipper-by-shipper.
 */
const PLAZO_SHIPPER_DEFAULT_DIAS = 30;

/**
 * Calcula el preview (cotización) de Cobra Hoy sin escribir nada en BD.
 * Útil para que el frontend muestre el desglose antes de confirmar.
 *
 * No exige flag — el preview puede mostrarse aunque el flag esté off,
 * para que el frontend pueda comunicar "esto recibirías" educacional.
 * Pero la confirmación real (POST cobraHoy) sí exige flag.
 */
export async function cotizarCobraHoy(input: CotizacionInput): Promise<CotizacionResult> {
  const {
    db,
    asignacionId,
    empresaCarrierId,
    plazoDiasShipper = PLAZO_SHIPPER_DEFAULT_DIAS,
  } = input;

  const asgRows = await db
    .select({
      id: assignments.id,
      empresaCarrierId: assignments.empresaId,
      deliveredAt: assignments.deliveredAt,
    })
    .from(assignments)
    .where(eq(assignments.id, asignacionId))
    .limit(1);
  const asg = asgRows[0];
  if (!asg) {
    return { status: 'assignment_not_found' };
  }
  if (asg.empresaCarrierId !== empresaCarrierId) {
    return { status: 'forbidden_owner_mismatch' };
  }

  const liqRows = await db
    .select({ montoNetoCarrierClp: liquidaciones.montoNetoCarrierClp })
    .from(liquidaciones)
    .where(eq(liquidaciones.asignacionId, asignacionId))
    .limit(1);
  const liq = liqRows[0];
  if (!liq) {
    return { status: 'no_liquidacion' };
  }

  const tarifa = calcularTarifaProntoPago({
    montoNetoClp: liq.montoNetoCarrierClp,
    plazoDiasShipper,
  });
  return {
    status: 'ok',
    montoNetoClp: tarifa.montoNetoClp,
    plazoDiasShipper: tarifa.plazoDiasShipper,
    tarifaPct: tarifa.tarifaPct,
    tarifaClp: tarifa.tarifaClp,
    montoAdelantadoClp: tarifa.montoAdelantadoClp,
  };
}

/**
 * Solicita un adelanto de pronto pago. Service con I/O — toca varias
 * tablas en cascada de validación.
 */
export async function cobraHoy(input: CobraHoyInput): Promise<CobraHoyResult> {
  const { db, logger, asignacionId, empresaCarrierId, factoringV1Activated } = input;

  if (!factoringV1Activated) {
    logger.debug({ asignacionId }, 'cobraHoy: FACTORING_V1_ACTIVATED=false, skip');
    return { status: 'skipped_flag_disabled' };
  }

  // (1) Lookup assignment + ownership + delivered.
  const asgRows = await db
    .select({
      id: assignments.id,
      tripId: assignments.tripId,
      empresaCarrierId: assignments.empresaId,
      deliveredAt: assignments.deliveredAt,
    })
    .from(assignments)
    .where(eq(assignments.id, asignacionId))
    .limit(1);
  const asg = asgRows[0];
  if (!asg) {
    return { status: 'assignment_not_found' };
  }
  if (asg.empresaCarrierId !== empresaCarrierId) {
    return { status: 'forbidden_owner_mismatch' };
  }
  if (!asg.deliveredAt) {
    return { status: 'assignment_not_delivered' };
  }

  // (2) Lookup trip para empresaShipperId.
  const tripRows = await db
    .select({
      generadorCargaEmpresaId: trips.generadorCargaEmpresaId,
    })
    .from(trips)
    .where(eq(trips.id, asg.tripId))
    .limit(1);
  const trip = tripRows[0];
  if (!trip || !trip.generadorCargaEmpresaId) {
    return { status: 'assignment_not_found' };
  }
  const empresaShipperId = trip.generadorCargaEmpresaId;

  // (3) Lookup liquidación.
  const liqRows = await db
    .select({
      id: liquidaciones.id,
      montoNetoCarrierClp: liquidaciones.montoNetoCarrierClp,
    })
    .from(liquidaciones)
    .where(eq(liquidaciones.asignacionId, asignacionId))
    .limit(1);
  const liq = liqRows[0];
  if (!liq) {
    return { status: 'no_liquidacion' };
  }

  // (4) Lookup shipper credit decision vigente.
  const decRows = await db
    .select({
      approved: shipperCreditDecisions.approved,
      limitExposureClp: shipperCreditDecisions.limitExposureClp,
      currentExposureClp: shipperCreditDecisions.currentExposureClp,
      motivo: shipperCreditDecisions.motivo,
    })
    .from(shipperCreditDecisions)
    .where(
      and(
        eq(shipperCreditDecisions.empresaShipperId, empresaShipperId),
        gt(shipperCreditDecisions.expiresAt, sql`now()`),
      ),
    )
    .limit(1);
  const dec = decRows[0];
  if (!dec || !dec.approved) {
    return {
      status: 'shipper_no_aprobado',
      motivo: dec?.motivo ?? 'Shipper sin decisión vigente aprobada',
    };
  }

  // (5) Validar exposición + monto del adelanto no exceda límite.
  const tarifa = calcularTarifaProntoPago({
    montoNetoClp: liq.montoNetoCarrierClp,
    plazoDiasShipper: PLAZO_SHIPPER_DEFAULT_DIAS,
  });
  const nuevaExposicion = dec.currentExposureClp + tarifa.montoAdelantadoClp;
  if (nuevaExposicion > dec.limitExposureClp) {
    return {
      status: 'limite_exposicion_excedido',
      limitClp: dec.limitExposureClp,
      exposicionClp: nuevaExposicion,
    };
  }

  // (6) INSERT idempotente.
  try {
    const inserted = await db
      .insert(adelantosCarrier)
      .values({
        asignacionId,
        liquidacionId: liq.id,
        empresaCarrierId,
        empresaShipperId,
        montoNetoClp: tarifa.montoNetoClp,
        plazoDiasShipper: tarifa.plazoDiasShipper,
        tarifaPct: tarifa.tarifaPct.toFixed(2),
        tarifaClp: tarifa.tarifaClp,
        montoAdelantadoClp: tarifa.montoAdelantadoClp,
        status: 'solicitado',
        factoringMethodologyVersion: tarifa.factoringMethodologyVersion,
      })
      .returning({ id: adelantosCarrier.id });

    const adelantoId = inserted[0]?.id;
    if (!adelantoId) {
      throw new Error('cobraHoy: INSERT no devolvió id');
    }

    logger.info(
      {
        asignacionId,
        adelantoId,
        empresaCarrierId,
        empresaShipperId,
        montoNeto: tarifa.montoNetoClp,
        tarifa: tarifa.tarifaClp,
        montoAdelantado: tarifa.montoAdelantadoClp,
      },
      'cobraHoy: adelanto solicitado',
    );

    return {
      status: 'solicitado',
      adelantoId,
      tarifaPct: tarifa.tarifaPct,
      tarifaClp: tarifa.tarifaClp,
      montoAdelantadoClp: tarifa.montoAdelantadoClp,
    };
  } catch (err) {
    if (err instanceof Error && /unique|duplicate/i.test(err.message)) {
      const existing = await db
        .select({ id: adelantosCarrier.id })
        .from(adelantosCarrier)
        .where(eq(adelantosCarrier.asignacionId, asignacionId))
        .limit(1);
      const existingId = existing[0]?.id;
      if (existingId) {
        return { status: 'ya_solicitado', adelantoId: existingId };
      }
    }
    throw err;
  }
}
