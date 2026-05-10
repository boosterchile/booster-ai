import { DEFAULT_IVA_RATE_CL } from './liquidacion.js';
import type { CobroMembershipInput, CobroMembershipOutput } from './types.js';

/**
 * Cálculo puro del cobro de la cuota mensual de membresía del carrier.
 * Llamado por el cron mensual en `apps/api/src/jobs/cobrar-memberships-mensual.ts`.
 *
 * Carrier en tier Free → `status='tier_gratis_skip'`, factura null.
 * Carrier en tier pagado → factura con subtotal=fee, IVA, total y
 * fecha de vencimiento (hoy + diasVencimiento).
 *
 * Por qué `hoyMs` es inyectable: permite tests deterministas sin
 * `vi.useFakeTimers()`, y permite re-emitir facturas retroactivas
 * con la fecha original si fuese necesario.
 *
 * Ver ADR-030 §7.
 */
export function calcularCobroMembership(input: CobroMembershipInput): CobroMembershipOutput {
  const { tier, ivaRate = DEFAULT_IVA_RATE_CL, hoyMs, diasVencimiento = 14 } = input;

  if (!Number.isFinite(hoyMs) || hoyMs <= 0) {
    throw new Error(`calcularCobroMembership: hoyMs inválido (${hoyMs})`);
  }
  if (!Number.isInteger(diasVencimiento) || diasVencimiento <= 0) {
    throw new Error(
      `calcularCobroMembership: diasVencimiento debe ser integer > 0 (${diasVencimiento})`,
    );
  }

  if (tier.feeMonthlyClp === 0) {
    return { status: 'tier_gratis_skip', factura: null };
  }

  if (!Number.isInteger(tier.feeMonthlyClp) || tier.feeMonthlyClp < 0) {
    throw new Error(`calcularCobroMembership: tier.feeMonthlyClp inválido (${tier.feeMonthlyClp})`);
  }

  const subtotalClp = tier.feeMonthlyClp;
  const ivaClp = Math.round(subtotalClp * ivaRate);
  const totalClp = subtotalClp + ivaClp;
  const venceEn = new Date(hoyMs + diasVencimiento * 24 * 60 * 60 * 1000);

  return {
    status: 'creada',
    factura: { subtotalClp, ivaClp, totalClp, venceEn },
  };
}

/**
 * Helper para construir el slug `YYYY-MM` desde una fecha. Útil para
 * el cron mensual. Mantiene la zona Chile (UTC-3 sin DST en estándar,
 * pero usamos UTC-3 fijo para que el "mes" sea estable independiente
 * de horarios de verano).
 *
 * Ej. `periodoMesDesde(new Date('2026-06-15T03:00:00Z'))` → `'2026-06'`.
 */
export function periodoMesDesde(date: Date): string {
  const cl = new Date(date.getTime() - 3 * 60 * 60 * 1000); // UTC-3
  const y = cl.getUTCFullYear();
  const m = String(cl.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}
