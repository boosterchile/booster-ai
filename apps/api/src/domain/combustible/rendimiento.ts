/**
 * Única fuente del rendimiento de combustible: km/L y L/100 km.
 * La fila del trayecto, el KPI del hub, la plausibilidad CAN y la web
 * (vía la API) usan estas funciones. Ningún otro archivo divide km por litros.
 * Spec: `.specs/modulo-rendimiento-unico/spec.md`.
 */

/**
 * Muestra mínima para un km/L: el 83 viene en pasos de 0,5 L y el 84 oscila
 * con el oleaje. Con menos litros o menos km el número no es confiable.
 */
export const LITROS_MINIMOS_KM_POR_LITRO = 5;
export const KM_MINIMOS_KM_POR_LITRO = 10;
/**
 * Baseline diésel del diagnóstico JLKT54 (32 L/100 km → 3,125 km/L).
 * Por encima de 2× ese rendimiento el km/L no se publica.
 */
export const CONSUMO_BASE_DIESEL_L_POR_100_KM = 32;
export const FACTOR_MAX_KM_POR_LITRO_CONFIABLE = 2;

export interface Rendimiento {
  /** km / L, a 2 decimales. */
  kmPorLitro: number;
  /** L / km × 100, a 1 decimal. Sale de los mismos km y litros, no del km/L redondeado. */
  litrosPor100Km: number;
}

export interface TramoRendimiento {
  km: number;
  litros: number;
}

/** 2 × (100 / 32) = 6,25 km/L. */
export function kmPorLitroMaxConfiable(): number {
  return FACTOR_MAX_KM_POR_LITRO_CONFIABLE * (100 / CONSUMO_BASE_DIESEL_L_POR_100_KM);
}

/** El valor que iguala 6,25 se muestra; sobre eso no. */
export function superaTopeConfiable(kmPorLitro: number): boolean {
  return kmPorLitro > kmPorLitroMaxConfiable();
}

function positivo(valor: number | null): valor is number {
  return valor != null && Number.isFinite(valor) && valor > 0;
}

/** Para comparar contra umbrales sin perder precisión. Null sin km o sin litros válidos. */
export function litrosPor100KmSinRedondear(
  km: number | null,
  litros: number | null,
): number | null {
  if (!positivo(km) || litros == null || !Number.isFinite(litros) || litros < 0) {
    return null;
  }
  return (litros / km) * 100;
}

/** km/L y L/100 km de un tramo. Null si faltan km o litros mayores que cero. */
export function rendimiento(km: number | null, litros: number | null): Rendimiento | null {
  if (!positivo(km) || !positivo(litros)) {
    return null;
  }
  return {
    kmPorLitro: redondear(km / litros, 2),
    litrosPor100Km: redondear((litros / km) * 100, 1),
  };
}

/** Σkm / ΣL de varios tramos. No es el promedio de los cocientes. */
export function rendimientoAgregado(tramos: readonly TramoRendimiento[]): Rendimiento | null {
  let km = 0;
  let litros = 0;
  for (const tramo of tramos) {
    km += tramo.km;
    litros += tramo.litros;
  }
  return rendimiento(km, litros);
}

function redondear(valor: number, decimales: number): number {
  const factor = 10 ** decimales;
  return Math.round((valor + Number.EPSILON) * factor) / factor;
}
