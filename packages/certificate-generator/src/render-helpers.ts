/**
 * Helpers puros para la selección de copy y formato del cert según el
 * nivel de certificación (ADR-028). Extraídos de `generar-pdf-base.ts`
 * para testearlos independiente de pdf-lib (los strings dentro del PDF
 * binary quedan codificados por el font, así que assertions sobre
 * `pdfStr` no son confiables).
 */

import type { DatosMetricasCertificado } from './tipos.js';

export type NivelCertificacion = NonNullable<DatosMetricasCertificado['certificationLevel']>;

/**
 * Título principal del header del PDF según el nivel de certificación.
 *
 * - `primario_verificable` → "CERTIFICADO" (cert auditable bajo SBTi/CDP)
 * - `secundario_*` → "REPORTE ESTIMATIVO" (no auditable)
 *
 * El cambio de palabra es deliberado: "Reporte" comunica al cliente que
 * NO es un certificado en sentido estricto bajo GLEC §4.4 nivel 1.
 */
export function tituloHeader(nivel: NivelCertificacion): string {
  return nivel === 'primario_verificable'
    ? 'CERTIFICADO DE HUELLA DE CARBONO'
    : 'REPORTE ESTIMATIVO DE HUELLA DE CARBONO';
}

/**
 * Subtítulo del header. Aclara la metodología y la calidad del dato.
 */
export function subtituloHeader(nivel: NivelCertificacion): string {
  return nivel === 'primario_verificable'
    ? 'GLEC Framework v3.0  ·  Datos primarios verificables'
    : 'GLEC Framework v3.0  ·  Datos secundarios modelados';
}

/**
 * Tamaño del texto del título. Reducido en modo secundario porque la
 * cadena es más larga ("REPORTE ESTIMATIVO..." vs "CERTIFICADO...") y
 * cabe peor en el ancho del header con el font size original.
 */
export function tamanoTitulo(nivel: NivelCertificacion): number {
  return nivel === 'primario_verificable' ? 18 : 16;
}

/**
 * `true` si el cert debe llevar disclaimer prominente de "datos secundarios
 * modelados, no auditable bajo SBTi/CDP". Es el mecanismo de greenwashing
 * prevention de ADR-028 §4.
 */
export function muestraDisclaimerSecundario(nivel: NivelCertificacion): boolean {
  return nivel !== 'primario_verificable';
}

/**
 * Líneas del disclaimer secundario, ya partidas para no overflowear el
 * ancho del rectángulo en el PDF. Cualquier cambio del copy debe
 * mantener: (a) mención explícita "datos secundarios modelados",
 * (b) mención "NO auditable como dato primario", (c) path de upgrade
 * vía Teltonika.
 */
export const DISCLAIMER_SECUNDARIO_LINEAS: readonly string[] = [
  'Cálculo basado en datos secundarios modelados (Google Routes API + factores SEC Chile 2024).',
  'NO auditable como dato primario bajo SBTi/CDP. Para certificado verificable bajo GLEC §4.4',
  'nivel 1, contactar a Booster para activar telemetría Teltonika en su flota.',
] as const;

/**
 * Formatea el número principal de emisiones publicado en el cert.
 *
 * - Si no hay factor de incertidumbre o es 0 → "X.XX kg CO2e"
 * - Si hay factor en (0, 1] → "X.XX ± Y.YY kg CO2e"
 *
 * El intervalo simétrico (kgWtw × factor) sigue el estándar GLEC v3
 * Annex B: "publicar el factor de incertidumbre como ± absoluto en las
 * mismas unidades del valor reportado".
 *
 * Validación defensiva: factor fuera de [0, 1] tira error en vez de
 * imprimir un valor sin sentido en un cert firmado.
 */
export function formatearNumeroPrincipal(kgWtw: number, uncertaintyFactor?: number): string {
  if (uncertaintyFactor === undefined || uncertaintyFactor === 0) {
    return `${kgWtw.toFixed(2)} kg CO2e`;
  }
  if (uncertaintyFactor < 0 || uncertaintyFactor > 1 || Number.isNaN(uncertaintyFactor)) {
    throw new Error(
      `uncertaintyFactor debe estar en [0, 1], recibido ${uncertaintyFactor} (ADR-028 §3)`,
    );
  }
  return `${kgWtw.toFixed(2)} ± ${(kgWtw * uncertaintyFactor).toFixed(2)} kg CO2e`;
}

/**
 * Formato human-readable del origen de la ruta para imprimir en el cert.
 */
export function formatRouteDataSource(s: string): string {
  switch (s) {
    case 'teltonika_gps':
      return 'Telemetría Teltonika (GPS real)';
    case 'maps_directions':
      return 'Google Routes API (ruta modelada)';
    case 'manual_declared':
      return 'Declaración manual';
    default:
      return s;
  }
}
