/**
 * Mandato de cobro (ADR-080 §2) — funciones puras.
 *
 * El pago de un viaje tiene dos líneas que arrancan en la recepción
 * conforme y avanzan con eventos append-only (`eventos_pago_viaje`):
 *
 *   cobro al generador:        sin_recepcion → pendiente → (mora →) cobrado
 *   liberación al transportista: sin_recepcion → pendiente →
 *                                liberado_por_booster | anticipado_por_operador
 *                                (pendiente ⇄ disputa)
 *
 * La disputa congela la liberación, no el cobro. Ningún evento existe sin
 * recepción conforme. El float de terceros es la caja propia de Booster
 * expuesta: lo liberado por Booster cuyo cobro aún no entra.
 */

export type TipoEventoPago =
  | 'recepcion_conforme'
  | 'cobro_registrado'
  | 'mora_registrada'
  | 'liberacion_booster'
  | 'anticipo_operador'
  | 'disputa_abierta'
  | 'disputa_resuelta';

export type EstadoCobro = 'sin_recepcion' | 'pendiente' | 'mora' | 'cobrado';
export type EstadoLiberacion =
  | 'sin_recepcion'
  | 'pendiente'
  | 'disputa'
  | 'liberado_por_booster'
  | 'anticipado_por_operador';

export interface EventoPago {
  tipo: TipoEventoPago;
  ocurridoEn: Date;
  montoClp: number | null;
}

export interface LineaPago<E> {
  estado: E;
  /** Cuándo llegó a su estado actual (null mientras no arranca). */
  en: Date | null;
  /** Monto movido por el evento que la cerró (cobro, liberación o anticipo). */
  montoClp: number | null;
}

export interface PagoViaje {
  recepcionConformeEn: Date | null;
  cobro: LineaPago<EstadoCobro>;
  liberacion: LineaPago<EstadoLiberacion>;
}

export const ESTADO_PAGO_INICIAL: PagoViaje = {
  recepcionConformeEn: null,
  cobro: { estado: 'sin_recepcion', en: null, montoClp: null },
  liberacion: { estado: 'sin_recepcion', en: null, montoClp: null },
};

export type CodigoRechazoPago =
  | 'sin_recepcion_conforme'
  | 'recepcion_duplicada'
  | 'fecha_anterior_a_recepcion'
  | 'cobro_no_pendiente'
  | 'mora_antes_de_vencer'
  | 'liberacion_no_pendiente'
  | 'liberacion_en_disputa'
  | 'sin_disputa_abierta'
  | 'monto_invalido';

export type ResultadoValidacion = { ok: true } | { ok: false; code: CodigoRechazoPago };

export interface ContextoValidacion {
  /** Monto exacto que debe traer un cobro, una liberación o un anticipo. */
  montoEsperadoClp?: number;
  /** Vencimiento del cobro; la mora no se registra antes. */
  cobroVenceEn?: Date;
}

export class TransicionPagoInvalidaError extends Error {
  constructor(
    public readonly code: CodigoRechazoPago,
    public readonly tipo: TipoEventoPago,
  ) {
    super(`transición de pago inválida (${tipo}): ${code}`);
    this.name = 'TransicionPagoInvalidaError';
  }
}

const rechazo = (code: CodigoRechazoPago): ResultadoValidacion => ({ ok: false, code });

function montoValido(evento: EventoPago, ctx: ContextoValidacion): boolean {
  return (
    evento.montoClp !== null &&
    Number.isInteger(evento.montoClp) &&
    evento.montoClp > 0 &&
    evento.montoClp === ctx.montoEsperadoClp
  );
}

function validarLiberacionPendiente(estado: PagoViaje): ResultadoValidacion | null {
  if (estado.liberacion.estado === 'disputa') {
    return rechazo('liberacion_en_disputa');
  }
  if (estado.liberacion.estado !== 'pendiente') {
    return rechazo('liberacion_no_pendiente');
  }
  return null;
}

/**
 * ¿Puede `evento` aplicarse sobre `estado`? Las reglas de monto y de
 * vencimiento usan `ctx`; sin `ctx` se rechazan (falla cerrado).
 */
export function validarEvento(
  estado: PagoViaje,
  evento: EventoPago,
  ctx: ContextoValidacion,
): ResultadoValidacion {
  if (evento.tipo === 'recepcion_conforme') {
    return estado.recepcionConformeEn ? rechazo('recepcion_duplicada') : { ok: true };
  }
  if (!estado.recepcionConformeEn) {
    return rechazo('sin_recepcion_conforme');
  }
  if (evento.ocurridoEn.getTime() < estado.recepcionConformeEn.getTime()) {
    return rechazo('fecha_anterior_a_recepcion');
  }
  switch (evento.tipo) {
    case 'cobro_registrado':
      if (estado.cobro.estado !== 'pendiente' && estado.cobro.estado !== 'mora') {
        return rechazo('cobro_no_pendiente');
      }
      return montoValido(evento, ctx) ? { ok: true } : rechazo('monto_invalido');
    case 'mora_registrada':
      if (estado.cobro.estado !== 'pendiente') {
        return rechazo('cobro_no_pendiente');
      }
      if (!ctx.cobroVenceEn || evento.ocurridoEn.getTime() < ctx.cobroVenceEn.getTime()) {
        return rechazo('mora_antes_de_vencer');
      }
      return { ok: true };
    case 'liberacion_booster':
    case 'anticipo_operador': {
      const noPendiente = validarLiberacionPendiente(estado);
      if (noPendiente) {
        return noPendiente;
      }
      return montoValido(evento, ctx) ? { ok: true } : rechazo('monto_invalido');
    }
    case 'disputa_abierta':
      return validarLiberacionPendiente(estado) ?? { ok: true };
    case 'disputa_resuelta':
      return estado.liberacion.estado === 'disputa' ? { ok: true } : rechazo('sin_disputa_abierta');
  }
}

/** Aplica un evento ya validado. */
function aplicarEvento(estado: PagoViaje, evento: EventoPago): PagoViaje {
  const en = evento.ocurridoEn;
  switch (evento.tipo) {
    case 'recepcion_conforme':
      return {
        recepcionConformeEn: en,
        cobro: { estado: 'pendiente', en, montoClp: null },
        liberacion: { estado: 'pendiente', en, montoClp: null },
      };
    case 'cobro_registrado':
      return { ...estado, cobro: { estado: 'cobrado', en, montoClp: evento.montoClp } };
    case 'mora_registrada':
      return { ...estado, cobro: { estado: 'mora', en, montoClp: null } };
    case 'liberacion_booster':
      return {
        ...estado,
        liberacion: { estado: 'liberado_por_booster', en, montoClp: evento.montoClp },
      };
    case 'anticipo_operador':
      return {
        ...estado,
        liberacion: { estado: 'anticipado_por_operador', en, montoClp: evento.montoClp },
      };
    case 'disputa_abierta':
      return { ...estado, liberacion: { estado: 'disputa', en, montoClp: null } };
    case 'disputa_resuelta':
      return { ...estado, liberacion: { estado: 'pendiente', en, montoClp: null } };
  }
}

/**
 * Estado actual de un viaje a partir de sus eventos **en orden de registro**
 * (`secuencia`). Los eventos ya se validaron al insertarse; una secuencia
 * inválida es corrupción de datos y lanza, no se oculta. Las reglas de monto
 * y vencimiento se verificaron al insertar y no se repiten acá.
 */
export function reducirPagoViaje(eventos: readonly EventoPago[]): PagoViaje {
  let estado = ESTADO_PAGO_INICIAL;
  for (const evento of eventos) {
    const r = validarEvento(estado, evento, {
      ...(evento.montoClp === null ? {} : { montoEsperadoClp: evento.montoClp }),
      cobroVenceEn: evento.ocurridoEn,
    });
    if (!r.ok) {
      throw new TransicionPagoInvalidaError(r.code, evento.tipo);
    }
    estado = aplicarEvento(estado, evento);
  }
  return estado;
}

/** ADR-080 §1: el generador paga flete + comisión + IVA; el transportista recibe su precio íntegro. */
export function montosEsperados(liq: {
  precioTransportistaClp: number;
  totalFacturaGeneradorClp: number;
}): { cobroClp: number; liberacionClp: number } {
  return {
    cobroClp: liq.precioTransportistaClp + liq.totalFacturaGeneradorClp,
    liberacionClp: liq.precioTransportistaClp,
  };
}

const DIA_MS = 86_400_000;

export interface PlazosMandato {
  pagoGeneradorDias: number;
  liberacionTransportistaDias: number;
}

export function vencimientos(
  recepcionConformeEn: Date,
  plazos: PlazosMandato,
): { cobroVenceEn: Date; liberacionVenceEn: Date } {
  const base = recepcionConformeEn.getTime();
  return {
    cobroVenceEn: new Date(base + plazos.pagoGeneradorDias * DIA_MS),
    liberacionVenceEn: new Date(base + plazos.liberacionTransportistaDias * DIA_MS),
  };
}

/** Qué le toca al job diario sobre un viaje: registrar mora y/o alertar liberación vencida. */
export function revisarVencimientos(
  pago: PagoViaje,
  plazos: PlazosMandato,
  ahora: Date,
): { requiereMora: boolean; liberacionVencida: boolean } {
  if (!pago.recepcionConformeEn) {
    return { requiereMora: false, liberacionVencida: false };
  }
  const v = vencimientos(pago.recepcionConformeEn, plazos);
  return {
    requiereMora: pago.cobro.estado === 'pendiente' && ahora.getTime() >= v.cobroVenceEn.getTime(),
    liberacionVencida:
      pago.liberacion.estado === 'pendiente' && ahora.getTime() > v.liberacionVenceEn.getTime(),
  };
}

/** Float de terceros: Σ liberado por Booster cuyo cobro aún no entra. */
export function calcularFloat(pagos: readonly PagoViaje[]): number {
  let total = 0;
  for (const p of pagos) {
    if (p.liberacion.estado === 'liberado_por_booster' && p.cobro.estado !== 'cobrado') {
      total += p.liberacion.montoClp ?? 0;
    }
  }
  return total;
}

/**
 * ADR-080 §6.3 / Verificación 4: una liberación de Booster antes del cobro
 * consume caja propia y no puede superar el tope. Con el cobro ya cobrado no
 * hay exposición y no se limita.
 */
export function verificarTopeFloat(opts: {
  floatActualClp: number;
  montoClp: number;
  topeClp: number;
  cobroYaCobrado: boolean;
}): { ok: true } | { ok: false; code: 'tope_float_excedido'; disponibleClp: number } {
  if (opts.cobroYaCobrado || opts.floatActualClp + opts.montoClp <= opts.topeClp) {
    return { ok: true };
  }
  return {
    ok: false,
    code: 'tope_float_excedido',
    disponibleClp: Math.max(0, opts.topeClp - opts.floatActualClp),
  };
}

/** Días entre dos fechas, con dos decimales. */
export function diasEntre(desde: Date, hasta: Date): number {
  return Math.round(((hasta.getTime() - desde.getTime()) / DIA_MS) * 100) / 100;
}
