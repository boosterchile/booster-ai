/**
 * Datos de una carga que viajó con otras en la misma ruta (ADR-089, spec
 * huella-consolidada §3.10). Van en el certificado para que quien lo lee
 * pueda verificar la cuenta: la parte de la carga es su participación sobre
 * la huella total de la ruta.
 *
 * El certificado no identifica a los otros generadores ni dice cuántos son.
 */
export interface ConsolidacionCertificado {
  /** Participación de la carga en la huella de la ruta, porcentaje en (0, 100). */
  participacionPct: number;
  /** Huella WTW de la ruta completa, en kg CO₂e. */
  kgco2eWtwRuta: number;
  /** Versión del método de reparto con que se calculó. */
  versionMetodo: string;
}

/** Cómo se llama el método en el certificado. La versión va aparte. */
export const TEXTO_METODO_REPARTO = 'Toneladas-kilómetro, distancia directa';

export const FRASE_CONSOLIDACION =
  'Esta carga viajó con otras cargas en la misma ruta. Su huella es la parte que le corresponde de la huella total de la ruta.';

/**
 * Valida los datos antes de imprimirlos en un certificado firmado. `kgCarga`
 * es la cifra principal del certificado: no puede superar la de la ruta.
 */
export function validarConsolidacion(
  c: ConsolidacionCertificado | undefined,
  kgCarga: number,
): ConsolidacionCertificado | null {
  if (c === undefined) {
    return null;
  }
  if (!(c.participacionPct > 0 && c.participacionPct < 100)) {
    throw new Error(
      `participación de una carga consolidada fuera de (0, 100): ${c.participacionPct}`,
    );
  }
  if (!Number.isFinite(c.kgco2eWtwRuta) || c.kgco2eWtwRuta < kgCarga) {
    throw new Error(
      `la huella de la ruta (${c.kgco2eWtwRuta}) no puede ser menor que la de la carga (${kgCarga})`,
    );
  }
  if (c.versionMetodo.trim() === '') {
    throw new Error('falta la versión del método de reparto');
  }
  return c;
}
