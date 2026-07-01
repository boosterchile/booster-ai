/**
 * Máquina de estados PURA del dunning (reintentos de cobro) de las
 * facturas mensuales de membresía. ADR-031 §"reintentos": hasta 3
 * reintentos con backoff fijo. Sin I/O, sin Date.now() — el caller
 * (el cron `cobrar-memberships-mensual`) inyecta `hoyMs`.
 *
 * Separamos esta lógica del service orquestador para poder testear el
 * state-machine de forma determinista (dominio crítico → función pura,
 * regla de arquitectura Booster: los algoritmos viven en `packages/`).
 *
 * IMPORTANTE: esta función NO mueve dinero. Solo decide el estado
 * siguiente dado el resultado que el `MembershipPaymentGateway` reportó.
 * Mientras el gateway sea el stub no-op (no existe `payment-provider`),
 * el resultado real será siempre `pending_provider`.
 */

/**
 * Resultado que reporta el gateway de pago tras intentar cobrar una
 * factura de membresía.
 *
 *   - `pagada`           : el rail de pago confirmó el cobro (solo con un
 *                          provider real conectado).
 *   - `pending_provider` : NO se cobró — el stub no-op lo deja pendiente de
 *                          que exista `payment-provider`. Estado por defecto
 *                          mientras el rail real no esté integrado.
 *   - `rechazada`        : el provider intentó y el cobro falló (fondos
 *                          insuficientes, tarjeta vencida, etc.).
 */
export type ResultadoGatewayPago = 'pagada' | 'pending_provider' | 'rechazada';

/**
 * Estado de cobranza (dunning) de una factura de membresía. Vive en la
 * columna `facturas_booster_clp.cobro_estado` (separada del `status`
 * contable de la factura para no tocar su CHECK existente).
 *
 *   - `pendiente_cobro`           : creada, aún sin intentar cobrar.
 *   - `pending_payment_provider`  : 1er intento dejó el cobro pendiente del
 *                                   provider real (stub no-op). NO cobrada.
 *   - `reintentando`              : intento intermedio fallido/pendiente,
 *                                   con reintento agendado.
 *   - `morosa`                    : agotó los 3 intentos sin cobrar.
 *   - `cobrada`                   : el rail de pago confirmó el cobro.
 */
export type CobroEstadoDunning =
  | 'pendiente_cobro'
  | 'pending_payment_provider'
  | 'reintentando'
  | 'morosa'
  | 'cobrada';

/** Máximo de intentos de cobro antes de declarar la factura morosa (ADR-031). */
export const DUNNING_MAX_INTENTOS = 3;

/** Días de backoff entre reintentos de cobro (ADR-031: "cada 7 días"). */
export const DUNNING_BACKOFF_DIAS = 7;

export interface DecidirDunningInput {
  /** Nº de intentos de cobro YA realizados antes de éste. 0 en el primero. */
  intentosPrevios: number;
  /** Lo que reportó el `MembershipPaymentGateway` en este intento. */
  resultadoGateway: ResultadoGatewayPago;
  /** epoch ms del "ahora" del cron. Inyectable para tests deterministas. */
  hoyMs: number;
  /** Override de días de backoff (default `DUNNING_BACKOFF_DIAS`). */
  backoffDias?: number;
}

export interface DecidirDunningOutput {
  /** Estado de cobranza resultante. */
  cobroEstado: CobroEstadoDunning;
  /** Contador de intentos tras éste (= intentosPrevios + 1, salvo éxito). */
  cobroIntentos: number;
  /** epoch ms del próximo reintento, o null si ya no se reintenta. */
  proximoIntentoEnMs: number | null;
  /** Conveniencia: true si el resultado es la factura morosa. */
  esMorosa: boolean;
}

const RESULTADOS_VALIDOS: ReadonlySet<ResultadoGatewayPago> = new Set([
  'pagada',
  'pending_provider',
  'rechazada',
]);

/**
 * Decide el estado de dunning siguiente dado el resultado del gateway.
 *
 * @throws Error si `intentosPrevios` está fuera de `[0, DUNNING_MAX_INTENTOS)`,
 *   si `hoyMs` no es finito > 0, o si `resultadoGateway` no es soportado.
 *   Inputs inválidos son bug del caller — no devolvemos un estado silencioso.
 */
export function decidirSiguienteDunning(input: DecidirDunningInput): DecidirDunningOutput {
  const { intentosPrevios, resultadoGateway, hoyMs, backoffDias = DUNNING_BACKOFF_DIAS } = input;

  if (
    !Number.isInteger(intentosPrevios) ||
    intentosPrevios < 0 ||
    intentosPrevios >= DUNNING_MAX_INTENTOS
  ) {
    throw new Error(
      `decidirSiguienteDunning: intentosPrevios debe ser integer en [0, ${DUNNING_MAX_INTENTOS}) (recibido ${intentosPrevios})`,
    );
  }
  if (!Number.isFinite(hoyMs) || hoyMs <= 0) {
    throw new Error(`decidirSiguienteDunning: hoyMs inválido (${hoyMs})`);
  }
  if (!RESULTADOS_VALIDOS.has(resultadoGateway)) {
    throw new Error(`decidirSiguienteDunning: resultadoGateway no soportado (${resultadoGateway})`);
  }
  if (!Number.isInteger(backoffDias) || backoffDias <= 0) {
    throw new Error(`decidirSiguienteDunning: backoffDias debe ser integer > 0 (${backoffDias})`);
  }

  const cobroIntentos = intentosPrevios + 1;

  // Éxito: el rail real confirmó el cobro.
  if (resultadoGateway === 'pagada') {
    return {
      cobroEstado: 'cobrada',
      cobroIntentos,
      proximoIntentoEnMs: null,
      esMorosa: false,
    };
  }

  // No cobrada (stub no-op pending, o rechazo real). Si agotó los intentos
  // → morosa; si no, agenda el siguiente con backoff.
  const agotada = cobroIntentos >= DUNNING_MAX_INTENTOS;
  if (agotada) {
    return {
      cobroEstado: 'morosa',
      cobroIntentos,
      proximoIntentoEnMs: null,
      esMorosa: true,
    };
  }

  // El primer intento pending del stub se marca explícitamente como
  // `pending_payment_provider` (deja claro que el cobro espera el provider
  // real, no que falló). Reintentos posteriores o rechazos → `reintentando`.
  const cobroEstado: CobroEstadoDunning =
    resultadoGateway === 'pending_provider' && intentosPrevios === 0
      ? 'pending_payment_provider'
      : 'reintentando';

  return {
    cobroEstado,
    cobroIntentos,
    proximoIntentoEnMs: hoyMs + backoffDias * 24 * 60 * 60 * 1000,
    esMorosa: false,
  };
}
