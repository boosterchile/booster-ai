import type { Logger } from '@booster-ai/logger';
import {
  type MembershipTier,
  type TierSlug,
  calcularCobroMembership,
  decidirSiguienteDunning,
  periodoMesDesde,
} from '@booster-ai/pricing-engine';
import { and, eq, gt } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { carrierMemberships, facturasBoosterClp, membershipTiers } from '../db/schema.js';
import type { MembershipPaymentGateway } from './membership-payment-gateway.js';

/**
 * Cron de cobro mensual de cuotas de membresía (gap B5: "engine construido,
 * cron diferido"). ADR-030 §7 + ADR-031 §"Acciones diferidas".
 *
 * Orquestador DELGADO: la aritmética del cobro vive en
 * `@booster-ai/pricing-engine` (`calcularCobroMembership`) y la máquina de
 * estados de reintentos en `decidirSiguienteDunning` (ambas puras). Este
 * service solo toca BD y coordina el gateway.
 *
 * ⚠️ EL RAIL DE PAGO ESTÁ STUBEADO. El `MembershipPaymentGateway` inyectado
 * por default es `noopMembershipPaymentGateway`, que NO mueve dinero y deja la
 * factura en `pending_payment_provider`. Esto replica cómo factoring
 * (`cobra-hoy`) stubea el partner externo. El cobro real llega cuando exista
 * `payment-provider` y se inyecte un gateway real — sin tocar esta lógica.
 *
 * Flujo por tick (un mes-periodo):
 *   0. Si `pricingV2Activated=false` → no-op total, sin tocar BD.
 *   1. SELECT memberships `activa` cuyo tier tiene fee mensual > 0 (Free no
 *      factura). El tier Free se omite por definición (ADR-031).
 *   2. Para cada membership, SELECT su factura `membership_mensual` del periodo
 *      en curso (idempotencia anclada también por el unique parcial en BD):
 *        - sin factura → calcular (pura) + INSERT + cobrar (gateway) + UPDATE dunning.
 *        - factura reintentable (pending_payment_provider/reintentando) con
 *          `cobro_proximo_intento_en` vencido → cobrar de nuevo + UPDATE dunning.
 *        - factura cobrada/morosa o aún no vencida para reintento → skip.
 *   3. Devuelve counts agregados para el log/observabilidad del cron.
 *
 * Idempotente: re-correr el tick no cobra dos veces el mismo ciclo. El unique
 * parcial `uq_facturas_membership_empresa_mes` (migración 0015) garantiza una
 * sola factura por empresa+mes a nivel BD; el INSERT captura la violación y la
 * cuenta como `ya_facturada`.
 */

export interface CobrarMembershipsInput {
  db: Db;
  logger: Logger;
  /** Port de pago. Por default debería inyectarse `noopMembershipPaymentGateway`. */
  gateway: MembershipPaymentGateway;
  /** = config.PRICING_V2_ACTIVATED. Si false, no-op total. */
  pricingV2Activated: boolean;
  /** epoch ms del "ahora" del cron. Inyectable para tests. Default Date.now(). */
  hoyMs?: number;
  /** Override del periodo 'YYYY-MM' (default derivado de hoyMs en zona Chile). */
  periodoMes?: string;
  /** Cap de memberships procesadas por tick (defensa de blast radius). */
  limite?: number;
}

export interface CobrarMembershipsCounts {
  periodoMes: string;
  /** Memberships pagadas evaluadas. */
  evaluadas: number;
  /** Facturas nuevas creadas este tick. */
  facturasCreadas: number;
  /** Reintentos de cobro ejecutados sobre facturas existentes. */
  reintentos: number;
  /** Facturas que quedaron en pending_payment_provider (stub no cobró). */
  pendingProvider: number;
  /** Facturas efectivamente cobradas (solo con gateway real). */
  cobradas: number;
  /** Facturas que agotaron los reintentos y quedaron morosas. */
  morosas: number;
  /** Facturas ya existentes del periodo (idempotencia / race). */
  yaFacturadas: number;
}

export type CobrarMembershipsResult =
  | { status: 'skipped_flag_disabled' }
  | ({ status: 'ok' } & CobrarMembershipsCounts);

/** Cap default de memberships por tick. */
const LIMITE_DEFAULT = 1000;

export class TierNotFoundError extends Error {
  constructor(public readonly tierSlug: string) {
    super(`Tier ${tierSlug} no encontrado en BD (seed faltante?)`);
    this.name = 'TierNotFoundError';
  }
}

interface MembershipRow {
  empresaId: string;
  tierSlug: string;
}

interface FacturaPeriodoRow {
  id: string;
  totalClp: number;
  cobroEstado: string;
  cobroIntentos: number;
  cobroProximoIntentoEn: Date | null;
}

export async function cobrarMembershipsMensual(
  input: CobrarMembershipsInput,
): Promise<CobrarMembershipsResult> {
  const {
    db,
    logger,
    gateway,
    pricingV2Activated,
    hoyMs = Date.now(),
    limite = LIMITE_DEFAULT,
  } = input;

  if (!pricingV2Activated) {
    logger.debug('cobrarMembershipsMensual: PRICING_V2_ACTIVATED=false, skip');
    return { status: 'skipped_flag_disabled' };
  }

  const periodoMes = input.periodoMes ?? periodoMesDesde(new Date(hoyMs));

  const counts: CobrarMembershipsCounts = {
    periodoMes,
    evaluadas: 0,
    facturasCreadas: 0,
    reintentos: 0,
    pendingProvider: 0,
    cobradas: 0,
    morosas: 0,
    yaFacturadas: 0,
  };

  // (1) Memberships activas en tier pagado (fee > 0). El JOIN con tiers filtra
  // el tier Free (fee=0) que no factura. rls-allowlist: cron platform-wide.
  const memberships: MembershipRow[] = await db
    .select({
      empresaId: carrierMemberships.empresaId,
      tierSlug: carrierMemberships.tierSlug,
    })
    .from(carrierMemberships)
    .innerJoin(membershipTiers, eq(membershipTiers.slug, carrierMemberships.tierSlug))
    .where(and(eq(carrierMemberships.status, 'activa'), gt(membershipTiers.feeMonthlyClp, 0)))
    .limit(limite);

  if (memberships.length === 0) {
    logger.debug({ periodoMes }, 'cobrarMembershipsMensual: sin memberships pagadas');
    return { status: 'ok', ...counts };
  }

  for (const mem of memberships) {
    counts.evaluadas += 1;

    // (2) Factura del periodo para esta empresa (idempotencia).
    const facturaRows = (await db
      .select({
        id: facturasBoosterClp.id,
        totalClp: facturasBoosterClp.totalClp,
        cobroEstado: facturasBoosterClp.cobroEstado,
        cobroIntentos: facturasBoosterClp.cobroIntentos,
        cobroProximoIntentoEn: facturasBoosterClp.cobroProximoIntentoEn,
      })
      .from(facturasBoosterClp)
      .where(
        and(
          eq(facturasBoosterClp.empresaDestinoId, mem.empresaId),
          eq(facturasBoosterClp.tipo, 'membership_mensual'),
          eq(facturasBoosterClp.periodoMes, periodoMes),
        ),
      )
      .limit(1)) as FacturaPeriodoRow[];
    const facturaExistente = facturaRows[0];

    if (facturaExistente) {
      await reintentarFacturaExistente({
        db,
        logger,
        gateway,
        empresaId: mem.empresaId,
        periodoMes,
        factura: facturaExistente,
        hoyMs,
        counts,
      });
    } else {
      await crearYcobrarFacturaNueva({ db, logger, gateway, mem, periodoMes, hoyMs, counts });
    }
  }

  logger.info(
    {
      event: 'membership.cron.tick',
      periodoMes,
      evaluadas: counts.evaluadas,
      facturasCreadas: counts.facturasCreadas,
      reintentos: counts.reintentos,
      pendingProvider: counts.pendingProvider,
      cobradas: counts.cobradas,
      morosas: counts.morosas,
      yaFacturadas: counts.yaFacturadas,
    },
    'cobrarMembershipsMensual: tick completado',
  );

  return { status: 'ok', ...counts };
}

/** Carga el tier completo desde BD (para los montos y el fee). */
async function cargarTier(db: Db, tierSlug: string): Promise<MembershipTier> {
  const tierRows = await db
    .select()
    .from(membershipTiers)
    .where(eq(membershipTiers.slug, tierSlug))
    .limit(1);
  const tierRow = tierRows[0];
  if (!tierRow) {
    throw new TierNotFoundError(tierSlug);
  }
  return {
    slug: tierRow.slug as TierSlug,
    displayName: tierRow.displayName,
    feeMonthlyClp: tierRow.feeMonthlyClp,
    commissionPct: Number(tierRow.commissionPct),
    matchingPriorityBoost: tierRow.matchingPriorityBoost,
    trustScoreBoost: tierRow.trustScoreBoost,
    deviceTeltonikaIncluded: tierRow.deviceTeltonikaIncluded,
  };
}

interface CrearArgs {
  db: Db;
  logger: Logger;
  gateway: MembershipPaymentGateway;
  mem: MembershipRow;
  periodoMes: string;
  hoyMs: number;
  counts: CobrarMembershipsCounts;
}

/** Crea la factura del periodo y ejecuta el 1er intento de cobro. */
async function crearYcobrarFacturaNueva(args: CrearArgs): Promise<void> {
  const { db, logger, gateway, mem, periodoMes, hoyMs, counts } = args;

  const tier = await cargarTier(db, mem.tierSlug);

  // Cómputo puro del cobro (subtotal=fee, IVA, total, venceEn).
  const cobro = calcularCobroMembership({
    empresaId: mem.empresaId,
    tier,
    periodoMes,
    hoyMs,
  });
  // tier pagado garantizado por el filtro fee>0; defensa por si cambió.
  if (cobro.status !== 'creada') {
    logger.warn(
      { empresaId: mem.empresaId, tierSlug: mem.tierSlug, status: cobro.status },
      'cobrarMembershipsMensual: tier sin fee, skip (no debería con filtro fee>0)',
    );
    return;
  }

  // INSERT factura. UNIQUE parcial (empresa+mes) → idempotencia ante race.
  let facturaId: string;
  try {
    const inserted = await db
      .insert(facturasBoosterClp)
      .values({
        empresaDestinoId: mem.empresaId,
        tipo: 'membership_mensual',
        periodoMes,
        subtotalClp: cobro.factura.subtotalClp,
        ivaClp: cobro.factura.ivaClp,
        totalClp: cobro.factura.totalClp,
        status: 'pendiente',
        cobroEstado: 'pendiente_cobro',
        cobroIntentos: 0,
        venceEn: cobro.factura.venceEn,
      })
      .returning({ id: facturasBoosterClp.id });
    const id = inserted[0]?.id;
    if (!id) {
      throw new Error('cobrarMembershipsMensual: INSERT factura no devolvió id');
    }
    facturaId = id;
  } catch (err) {
    if (err instanceof Error && /unique|duplicate/i.test(err.message)) {
      // Otro proceso/tick ya creó la factura de este ciclo. Idempotencia.
      counts.yaFacturadas += 1;
      logger.info(
        { empresaId: mem.empresaId, periodoMes },
        'cobrarMembershipsMensual: factura del periodo ya existe (idempotente)',
      );
      return;
    }
    throw err;
  }

  counts.facturasCreadas += 1;

  // 1er intento de cobro vía el gateway (stub no-op por default).
  await ejecutarIntentoYActualizar({
    db,
    logger,
    gateway,
    empresaId: mem.empresaId,
    periodoMes,
    facturaId,
    totalClp: cobro.factura.totalClp,
    intentosPrevios: 0,
    hoyMs,
    counts,
  });
}

interface ReintentarArgs {
  db: Db;
  logger: Logger;
  gateway: MembershipPaymentGateway;
  empresaId: string;
  periodoMes: string;
  factura: FacturaPeriodoRow;
  hoyMs: number;
  counts: CobrarMembershipsCounts;
}

/** Reintenta el cobro de una factura existente si toca según el dunning. */
async function reintentarFacturaExistente(args: ReintentarArgs): Promise<void> {
  const { db, logger, gateway, empresaId, periodoMes, factura, hoyMs, counts } = args;

  const reintentable =
    factura.cobroEstado === 'pending_payment_provider' || factura.cobroEstado === 'reintentando';
  if (!reintentable) {
    // cobrada / morosa / pendiente_cobro-sin-tocar → nada que hacer.
    return;
  }

  // Backoff: solo reintentar si ya venció el próximo intento agendado.
  const proximoMs = factura.cobroProximoIntentoEn?.getTime() ?? 0;
  if (proximoMs > hoyMs) {
    return;
  }

  counts.reintentos += 1;

  await ejecutarIntentoYActualizar({
    db,
    logger,
    gateway,
    empresaId,
    periodoMes,
    facturaId: factura.id,
    totalClp: factura.totalClp,
    intentosPrevios: factura.cobroIntentos,
    hoyMs,
    counts,
  });
}

interface IntentoArgs {
  db: Db;
  logger: Logger;
  gateway: MembershipPaymentGateway;
  empresaId: string;
  periodoMes: string;
  facturaId: string;
  totalClp: number;
  intentosPrevios: number;
  hoyMs: number;
  counts: CobrarMembershipsCounts;
}

/**
 * Ejecuta UN intento de cobro vía el gateway, decide el dunning (puro) y
 * persiste el resultado en la factura. Centraliza el UPDATE para que el 1er
 * intento y los reintentos compartan exactamente la misma transición.
 */
async function ejecutarIntentoYActualizar(args: IntentoArgs): Promise<void> {
  const {
    db,
    logger,
    gateway,
    empresaId,
    periodoMes,
    facturaId,
    totalClp,
    intentosPrevios,
    hoyMs,
    counts,
  } = args;

  // ⚠️ STUB: el gateway default NO cobra (devuelve pending_provider).
  const cobro = await gateway.cobrar({
    facturaId,
    empresaId,
    totalClp,
    periodoMes,
    intento: intentosPrevios + 1,
  });

  const dunning = decidirSiguienteDunning({
    intentosPrevios,
    resultadoGateway: cobro.resultado,
    hoyMs,
  });

  // Mapear el estado de cobranza al status contable de la factura.
  //   cobrada → pagada ; morosa → vencida ; resto → pendiente.
  const statusContable =
    dunning.cobroEstado === 'cobrada'
      ? 'pagada'
      : dunning.cobroEstado === 'morosa'
        ? 'vencida'
        : 'pendiente';

  const ahora = new Date(hoyMs);
  await db
    .update(facturasBoosterClp)
    .set({
      cobroEstado: dunning.cobroEstado,
      cobroIntentos: dunning.cobroIntentos,
      cobroUltimoIntentoEn: ahora,
      cobroProximoIntentoEn:
        dunning.proximoIntentoEnMs === null ? null : new Date(dunning.proximoIntentoEnMs),
      cobroGatewayRef: cobro.gatewayRef,
      status: statusContable,
      pagadaEn: dunning.cobroEstado === 'cobrada' ? ahora : null,
      updatedAt: ahora,
    })
    .where(eq(facturasBoosterClp.id, facturaId));

  // Contadores agregados.
  if (dunning.cobroEstado === 'cobrada') {
    counts.cobradas += 1;
  } else if (dunning.cobroEstado === 'morosa') {
    counts.morosas += 1;
  } else if (dunning.cobroEstado === 'pending_payment_provider') {
    counts.pendingProvider += 1;
  }

  logger.info(
    {
      event: 'membership.cron.factura',
      facturaId,
      empresaId,
      periodoMes,
      cobroEstado: dunning.cobroEstado,
      cobroIntentos: dunning.cobroIntentos,
      resultadoGateway: cobro.resultado,
    },
    'cobrarMembershipsMensual: intento de cobro procesado',
  );
}
