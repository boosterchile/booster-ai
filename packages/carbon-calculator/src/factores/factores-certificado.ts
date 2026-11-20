/**
 * HC-004 (opción d) — tabla versionada de los factores por litro que imprime
 * el certificado. La clave es el `factores_fuente` exacto guardado en la
 * emisión (0068): si mañana cambia el factor, cambia la fuente y hace falta
 * una fila nueva; los certificados viejos siguen resolviendo la suya.
 *
 * El modo por defecto guarda la fuente con un sufijo que nombra el tipo de
 * vehículo («… (defaults para tipo: camion_mediano)»). Los factores por litro
 * son los mismos, así que el sufijo se ignora al buscar la fila.
 *
 * Si la fuente no está o el factor WTW guardado no calza con la fila, no hay
 * desglose: el certificado imprime solo el factor guardado (el emisor lo
 * loguea). Criterio 13: TTW + WTT = WTW.
 */

export interface FactoresLineaCertificado {
  fuente: string;
  /** Cita corta para el PDF («Fuente de factores: …» y el disclaimer). */
  etiqueta: string;
  ttw: number;
  wtt: number;
  wtw: number;
}

const GLEC_V2_T32 =
  'GLEC Framework v2.0 (2019), ISBN 978-90-82-68790-3, Módulo 1, Tabla 32 (EU), p. 87';

export const TABLA_FACTORES_CERTIFICADO: readonly FactoresLineaCertificado[] = [
  { fuente: GLEC_V2_T32, etiqueta: 'GLEC v2.0 (2019), Tabla 32', ttw: 2.67, wtt: 0.57, wtw: 3.24 },
  {
    fuente: `${GLEC_V2_T32} (proxy 70% vs diésel puro)`,
    etiqueta: 'GLEC v2.0 (2019), Tabla 32 (híbrido: 70 % del diésel)',
    ttw: 1.869,
    wtt: 0.399,
    wtw: 2.268,
  },
];

/** Lo que agrega `modos/por-defecto.ts` a la fuente de los factores. */
const SUFIJO_MODO_POR_DEFECTO = / \(defaults para tipo: [^()]+\)$/;

/** Tolerancia: emission_factor_usado se guarda con 5 decimales. */
const TOLERANCIA = 0.0005;

export function factoresLineaCertificado(
  fuente: string | null,
  factorWtwUsado: number,
): FactoresLineaCertificado | null {
  const base = fuente?.replace(SUFIJO_MODO_POR_DEFECTO, '') ?? null;
  const fila = TABLA_FACTORES_CERTIFICADO.find((f) => f.fuente === base);
  if (!fila || Math.abs(fila.wtw - factorWtwUsado) > TOLERANCIA) {
    return null;
  }
  return { ...fila };
}
