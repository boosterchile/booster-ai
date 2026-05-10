import type { CalcularTarifaInput, CalcularTarifaOutput } from './types.js';

/**
 * Versión semver de la metodología de factoring. Cambios MINOR cuando
 * cambia la tabla de tarifas; MAJOR cuando cambia el modelo (ej. tarifa
 * variable por shipper individual). Capturada en cada adelanto persistido.
 */
export const FACTORING_METHODOLOGY_VERSION = 'factoring-v1.0-cl-2026.06' as const;

/**
 * Tabla de tarifas oficial (ADR-029 §2 + ADR-032 §3). Plazos
 * intermedios se interpolan linealmente. Plazos <30d aplican 1.5%
 * (tarifa piso). Plazos >90d aplican techo dinámico hasta 8%.
 */
const TARIFA_TABLA: ReadonlyArray<{ dias: number; pct: number }> = [
  { dias: 30, pct: 1.5 },
  { dias: 45, pct: 2.2 },
  { dias: 60, pct: 3.0 },
  { dias: 90, pct: 4.5 },
];

const TARIFA_TECHO_PCT = 8.0;
const TARIFA_TECHO_INCREMENTO_POR_15D = 0.5;

/**
 * Calcula la tarifa de pronto pago dado el monto neto al carrier y
 * el plazo del shipper. Función pura, determinista.
 *
 * Reglas:
 *   - plazo ≤ 30 días → 1.5% (tarifa piso)
 *   - 30 ≤ plazo ≤ 90 → interpolación lineal entre tabla
 *   - plazo > 90 → 4.5% + 0.5% por cada 15 días extras, techo 8%
 *
 * Tarifa se aplica sobre `montoNetoClp` (post-comisión Booster, ADR-030).
 * `montoAdelantadoClp = montoNetoClp - tarifaClp`.
 *
 * @throws Error si montoNetoClp < 0, no integer, o plazoDiasShipper ≤ 0.
 */
export function calcularTarifaProntoPago(input: CalcularTarifaInput): CalcularTarifaOutput {
  const { montoNetoClp, plazoDiasShipper } = input;

  if (!Number.isFinite(montoNetoClp) || montoNetoClp < 0) {
    throw new Error(
      `calcularTarifaProntoPago: montoNetoClp debe ser número finito >= 0 (recibido ${montoNetoClp})`,
    );
  }
  if (!Number.isInteger(montoNetoClp)) {
    throw new Error(
      `calcularTarifaProntoPago: montoNetoClp debe ser integer (recibido ${montoNetoClp})`,
    );
  }
  if (!Number.isFinite(plazoDiasShipper) || plazoDiasShipper <= 0) {
    throw new Error(
      `calcularTarifaProntoPago: plazoDiasShipper debe ser > 0 (recibido ${plazoDiasShipper})`,
    );
  }
  if (!Number.isInteger(plazoDiasShipper)) {
    throw new Error(
      `calcularTarifaProntoPago: plazoDiasShipper debe ser integer (recibido ${plazoDiasShipper})`,
    );
  }

  const tarifaPct = resolverTarifaPct(plazoDiasShipper);
  const tarifaClp = Math.round((montoNetoClp * tarifaPct) / 100);
  const montoAdelantadoClp = montoNetoClp - tarifaClp;

  return {
    montoNetoClp,
    plazoDiasShipper,
    tarifaPct,
    tarifaClp,
    montoAdelantadoClp,
    factoringMethodologyVersion: FACTORING_METHODOLOGY_VERSION,
  };
}

function resolverTarifaPct(plazoDias: number): number {
  // La tabla es una constante no vacía declarada al tope del módulo,
  // por lo que `primero` y `ultimo` siempre existen — verificamos
  // defensivamente para que el tipado refleje la garantía.
  const primero = TARIFA_TABLA[0];
  const ultimo = TARIFA_TABLA[TARIFA_TABLA.length - 1];
  if (!primero || !ultimo) {
    throw new Error('TARIFA_TABLA debe contener al menos un punto');
  }
  // Plazo en o bajo el mínimo → tarifa piso.
  if (plazoDias <= primero.dias) {
    return primero.pct;
  }
  // Plazo sobre el máximo de la tabla → techo dinámico.
  if (plazoDias >= ultimo.dias) {
    if (plazoDias === ultimo.dias) {
      return ultimo.pct;
    }
    const diasExtras = plazoDias - ultimo.dias;
    const incrementos = Math.ceil(diasExtras / 15);
    const proyectada = ultimo.pct + incrementos * TARIFA_TECHO_INCREMENTO_POR_15D;
    return Math.min(proyectada, TARIFA_TECHO_PCT);
  }
  // Plazo intermedio → interpolación lineal entre dos puntos de la tabla.
  for (let i = 0; i < TARIFA_TABLA.length - 1; i++) {
    const a = TARIFA_TABLA[i];
    const b = TARIFA_TABLA[i + 1];
    if (!a || !b) {
      continue;
    }
    if (plazoDias >= a.dias && plazoDias <= b.dias) {
      const ratio = (plazoDias - a.dias) / (b.dias - a.dias);
      const interpolada = a.pct + ratio * (b.pct - a.pct);
      // Redondear a 2 decimales para evitar precision noise.
      return Math.round(interpolada * 100) / 100;
    }
  }
  // Defensivo (no debería caer acá).
  return ultimo.pct;
}
