import type { EvaluarShipperOutput, EvaluarShipperParams } from './types.js';

/**
 * Score Equifax CL: rango 0-1000. Bajos los 500 se considera alto
 * riesgo. Sobre 700 es bajo riesgo. Estos thresholds son point estimates
 * iniciales — el partner factoring puede ajustarlos en su integración.
 */
const SCORE_MINIMO_AUTO_APROBADO = 700;
const SCORE_MINIMO_LIMITE_REDUCIDO = 550;
const ANTIGUEDAD_MINIMA_MESES = 24; // ADR-029 §3 — ≥2 años operacionales
const LIMITE_ESTANDAR_CLP = 50_000_000; // ADR-029 §3 — $50M revolving
const LIMITE_REDUCIDO_CLP = 10_000_000; // shipper score medio
const VALIDEZ_DECISION_DIAS_DEFAULT = 30;

/**
 * Evalúa si Booster debería aprobar pronto pago sobre los DTEs emitidos
 * a este shipper. Función pura — el caller obtiene los inputs de Equifax,
 * SII, etc. (o del partner factoring si éste hace su propio underwriting).
 *
 * Reglas (ADR-029 §3):
 *   - RUT debe estar activo en SII (sin esto, automático rechazo)
 *   - Antigüedad operacional ≥24 meses
 *   - Sin morosidad reportada últimos 12 meses
 *   - Score Equifax ≥700 → aprobado con límite estándar ($50M)
 *   - Score 550-699 → aprobado con límite reducido ($10M)
 *   - Score <550 → rechazado
 *   - Sin score (Equifax falla / no aplica) → manual_requerido
 *   - Si exposición actual ≥ límite proyectado → rechazado por concentración
 */
export function evaluarShipper(params: EvaluarShipperParams): EvaluarShipperOutput {
  const { input, hoyMs, validezDias = VALIDEZ_DECISION_DIAS_DEFAULT } = params;

  if (!Number.isFinite(hoyMs) || hoyMs <= 0) {
    throw new Error(`evaluarShipper: hoyMs inválido (${hoyMs})`);
  }
  if (!Number.isInteger(validezDias) || validezDias <= 0) {
    throw new Error(`evaluarShipper: validezDias debe ser integer > 0 (${validezDias})`);
  }

  const expiresAt = new Date(hoyMs + validezDias * 24 * 60 * 60 * 1000);

  // Hard rules: RUT inactivo, sin antigüedad, morosidad → rechazo inmediato.
  if (!input.rutActivo) {
    return reject(expiresAt, 'RUT no activo en SII');
  }
  if (input.antiguedadMeses < ANTIGUEDAD_MINIMA_MESES) {
    return reject(
      expiresAt,
      `Antigüedad operacional ${input.antiguedadMeses}m < mínimo ${ANTIGUEDAD_MINIMA_MESES}m`,
    );
  }
  if (input.morosidadUltimo12m) {
    return reject(expiresAt, 'Morosidad reportada en últimos 12 meses');
  }

  // Sin score Equifax → no podemos auto-aprobar; requiere decisión manual.
  if (input.equifaxScore === null || input.equifaxScore === undefined) {
    return {
      approved: false,
      limitExposureClp: 0,
      motivo: 'Score Equifax no disponible — requiere decisión manual',
      expiresAt,
      decidedBy: 'manual_requerido',
    };
  }

  if (!Number.isFinite(input.equifaxScore) || input.equifaxScore < 0) {
    throw new Error(`evaluarShipper: equifaxScore inválido (${input.equifaxScore})`);
  }

  // Score muy bajo → rechazo automático.
  if (input.equifaxScore < SCORE_MINIMO_LIMITE_REDUCIDO) {
    return reject(
      expiresAt,
      `Score ${input.equifaxScore} < mínimo ${SCORE_MINIMO_LIMITE_REDUCIDO}`,
    );
  }

  const limite =
    input.equifaxScore >= SCORE_MINIMO_AUTO_APROBADO ? LIMITE_ESTANDAR_CLP : LIMITE_REDUCIDO_CLP;

  // Concentración de exposición — si ya estamos por encima del límite que
  // este shipper soporta, no aprobar más adelantos hasta que pague.
  if (input.exposicionActualClp >= limite) {
    return reject(expiresAt, `Exposición actual ${input.exposicionActualClp} >= límite ${limite}`);
  }

  return {
    approved: true,
    limitExposureClp: limite,
    motivo: null,
    expiresAt,
    decidedBy: 'automatico',
  };
}

function reject(expiresAt: Date, motivo: string): EvaluarShipperOutput {
  return {
    approved: false,
    limitExposureClp: 0,
    motivo,
    expiresAt,
    decidedBy: 'automatico',
  };
}
