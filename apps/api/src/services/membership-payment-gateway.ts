import type { Logger } from '@booster-ai/logger';
import type { ResultadoGatewayPago } from '@booster-ai/pricing-engine';

/**
 * Port de pago para el cobro de cuotas de membresía (ADR-030 §7 + ADR-031).
 *
 * ⚠️ EL RAIL DE PAGO REAL ESTÁ STUBEADO. No existe `payment-provider` todavía.
 * El default (`noopMembershipPaymentGateway`) NO mueve dinero: registra la
 * intención y devuelve `pending_provider`, dejando la factura en
 * `pending_payment_provider`. Esto replica cómo factoring (`cobra-hoy`) stubea
 * el partner externo: el adelanto queda en `solicitado` hasta integrar el
 * partner; acá la factura queda pendiente del provider real.
 *
 * Cuando exista el provider real (Transbank/Khipu/Stripe/etc.), se implementa
 * esta interface contra su SDK y se inyecta en el cron `cobrar-memberships-mensual`
 * en lugar del stub — sin tocar la lógica de dunning ni el orquestador.
 */
export interface MembershipPaymentGateway {
  /**
   * Intenta cobrar una factura de membresía. NO debe lanzar por fallos de
   * negocio (fondos insuficientes, etc.): esos se reportan como
   * `resultado='rechazada'`. Reservar throws para errores de infraestructura.
   */
  cobrar(input: CobroGatewayInput): Promise<CobroGatewayResultado>;
}

export interface CobroGatewayInput {
  /** Id de la factura `facturas_booster_clp` que se intenta cobrar. */
  facturaId: string;
  /** Empresa carrier a la que se le cobra. */
  empresaId: string;
  /** Monto total a cobrar en CLP (subtotal + IVA). */
  totalClp: number;
  /** Periodo 'YYYY-MM' de la cuota. */
  periodoMes: string;
  /** Nº de intento (1-based) — útil para logging del provider real. */
  intento: number;
}

export interface CobroGatewayResultado {
  /** Veredicto del gateway (alimenta `decidirSiguienteDunning`). */
  resultado: ResultadoGatewayPago;
  /** Ref opaca del provider (id de transacción). NULL en el stub no-op. */
  gatewayRef: string | null;
}

/**
 * Stub no-op del gateway de pago. **NO COBRA NADA.** Devuelve siempre
 * `pending_provider` y `gatewayRef=null` para que el dunning marque la factura
 * `pending_payment_provider`. Es el default del cron hasta que exista
 * `payment-provider`.
 *
 * Logueamos `event='membership.payment.stub_noop'` para que sea obvio en los
 * logs que el cobro NO se ejecutó (no es un cobro silencioso).
 */
export function noopMembershipPaymentGateway(logger: Logger): MembershipPaymentGateway {
  return {
    async cobrar(input: CobroGatewayInput): Promise<CobroGatewayResultado> {
      logger.warn(
        {
          event: 'membership.payment.stub_noop',
          facturaId: input.facturaId,
          empresaId: input.empresaId,
          totalClp: input.totalClp,
          periodoMes: input.periodoMes,
          intento: input.intento,
        },
        'membership payment gateway STUB: no se cobró (no existe payment-provider); factura queda pending_payment_provider',
      );
      return { resultado: 'pending_provider', gatewayRef: null };
    },
  };
}
