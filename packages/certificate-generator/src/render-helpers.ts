/**
 * Helpers puros para la selección de copy y formato del cert según el
 * nivel de certificación (ADR-028). Extraídos de `generar-pdf-base.ts`
 * para testearlos independiente de pdf-lib (los strings dentro del PDF
 * binary quedan codificados por el font, así que assertions sobre
 * `pdfStr` no son confiables).
 */

import { lineaMetodoCertificacion } from '@booster-ai/carbon-calculator';
import type { DatosMetricasCertificado } from './tipos.js';

export type NivelCertificacion = NonNullable<DatosMetricasCertificado['certificationLevel']>;

/** HC-004 — título único para todos los niveles (decisión de Felipe, 14:41). */
export const TITULO_CERT = 'Certificado de huella de carbono';

/** Frase ISO exacta de Felipe: subtítulo L2 y Metodología. */
export const FRASE_ISO = 'Estos resultados han sido establecidos de acuerdo con ISO 14083:2023.';

/**
 * Título de la sección de ahorro por matching de retorno. FIJO a propósito
 * (decisión de Orquestador, decision.md 18:07, opción a): «§6.4» es una sección
 * de GLEC Framework v3.0 (Empty Backhaul Allocation, ADR-021). Es una cita del
 * MÉTODO, no la versión de la emisión: con otra version_glec la sección podría
 * no existir con ese número, así que no se interpola.
 */
export const TITULO_AHORRO = 'Ahorro CO\u2082e vía matching de retorno (método GLEC v3.0 §6.4)';

export const TITULO_DISCLAIMER = 'IMPORTANTE — DATOS SECUNDARIOS MODELADOS';

/** Subtítulo L1 con la versión GLEC (metodología) guardada en la emisión. */
export function subtituloMetodologia(glecVersion: string): string {
  return `GLEC Framework ${glecVersion} · ISO 14083:2023 · Well-to-Wheel (combustión + upstream)`;
}

export interface PresentacionNivel {
  /** true → sello ESTIMADO + disclaimer + «Estimado» en el pie. */
  estimado: boolean;
  badge: string;
}

/**
 * Única fuente del badge, el sello y el disclaimer (ux.md §Badge): así no
 * puede salir un badge primario con sello Estimado. La verdad es la emisión
 * (`certificationLevel`); el % es la cobertura con piso (nunca sube a 100).
 */
export function presentacionNivel(m: {
  certificationLevel?: NivelCertificacion;
  coveragePct?: number;
}): PresentacionNivel {
  const pct = Math.min(100, Math.max(0, Math.floor(m.coveragePct ?? 0)));
  const estimado = m.certificationLevel !== 'primario_verificable';
  return {
    estimado,
    badge: estimado
      ? `Estimado · datos secundarios modelados · ${pct}% telemetría`
      : `\u2713 Dato primario medido · ${pct}% telemetría`,
  };
}

/** Cuerpo del disclaimer: texto exacto de Felipe con fuente y versión de la emisión. */
export function textoDisclaimer(fuenteFactores: string | null, glecVersion: string): string {
  // Sin fuente guardada (filas previas a 0068) no se inventa una (criterio 12).
  const factores = fuenteFactores ? `factores ${fuenteFactores} + ` : '';
  return `Cálculo basado en datos secundarios modelados (Google Routes API + ${factores}GLEC Framework ${glecVersion}). NO auditable como dato primario bajo SBTi, CDP o CSRD assurance. Para certificado verificable con datos primarios (telemetría Teltonika), contactar a Booster.`;
}

/**
 * Referencia HuellaChile 2025 (ux.md, criterio 14; copy propuesto por UX y
 * aprobado por Orquestador 17:29): kg_ref = litros × (ttw_ref + wtt_ref).
 * Sin litros no hay línea. Nunca dice «certificado/verificado HuellaChile».
 */
export function lineasReferenciaHuellaChile(
  litros: number | null,
  ref: { ttw: number; wtt: number } | null | undefined,
): [string, string] | null {
  if (litros === null || !ref) {
    return null;
  }
  const kgRef = litros * (ref.ttw + ref.wtt);
  return [
    `Referencia HuellaChile 2025: ${numeroEsCl(kgRef)} kg CO\u2082e WTW`,
    `Calculado con los mismos ${numeroEsCl(litros)} L y los factores MMA 2025 (TTW ${numeroEsCl(ref.ttw, 3)} + WTT ${numeroEsCl(ref.wtt, 3)} kg CO\u2082e/L). Solo referencia: el resultado de este certificado es el de arriba.`,
  ];
}

/** Número es-CL: coma decimal y punto de miles (ux.md §Tipografía). */
export function numeroEsCl(n: number, decimales = 2): string {
  return n.toLocaleString('es-CL', {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  });
}

/**
 * Número principal del cert: valor (22 pt) y detalle «kg CO₂e (± Y kg)».
 * El ± es kgWtw × uncertaintyFactor (GLEC v3 Annex B); fuera de [0, 1] lanza
 * en vez de imprimir algo sin sentido en un cert firmado.
 */
export function formatearNumeroPrincipal(
  kgWtw: number,
  uncertaintyFactor?: number,
): { valor: string; detalle: string } {
  const valor = numeroEsCl(kgWtw);
  if (uncertaintyFactor === undefined || uncertaintyFactor === 0) {
    return { valor, detalle: 'kg CO\u2082e' };
  }
  if (uncertaintyFactor < 0 || uncertaintyFactor > 1 || Number.isNaN(uncertaintyFactor)) {
    throw new Error(
      `uncertaintyFactor debe estar en [0, 1], recibido ${uncertaintyFactor} (ADR-028 §3)`,
    );
  }
  return { valor, detalle: `kg CO\u2082e (± ${numeroEsCl(kgWtw * uncertaintyFactor)} kg)` };
}

/**
 * Declaración de honestidad de la distancia según la cobertura telemétrica
 * (F0-0 §7 / spec `distancia-real-hibrida`).
 *
 * **Invariante:** con cobertura < 100% el cert **NUNCA** declara "medida" a
 * secas — declara la mezcla `"medido X%, estimado (100−X)%"`, con `X = coveragePct`.
 * Impide reintroducir el sesgo direccional a la baja que motivó el fix (una
 * traza con huecos NO es un trayecto medido).
 *
 * - sin cobertura / ≤ 0% → distancia totalmente estimada → `"estimada"`.
 * - ≥ 100% → `"medida (100% telemetría)"`.
 * - 0 < X < 100 → `"medido X%, estimado (100−X)%"`.
 *
 * `X` se calcula con `Math.floor` (piso): nunca redondea la fracción medida
 * hacia arriba, así que jamás sobre-declara "medido".
 */
export function declaracionDistancia(coveragePct?: number): string {
  if (coveragePct === undefined || coveragePct <= 0) {
    return 'estimada';
  }
  if (coveragePct >= 100) {
    return 'medida (100% telemetría)';
  }
  const medido = Math.floor(coveragePct);
  const estimado = 100 - medido;
  return `medido ${medido}%, estimado ${estimado}%`;
}

/**
 * Formato human-readable del origen de la ruta para imprimir en el cert.
 *
 * ADR-077 §4 — vocabulario cerrado: «medida» aplica solo a la distancia y
 * «verificable» está prohibido fuera de `primario_verificable`. El móvil del
 * conductor mide distancia, nunca energía, y nunca es primario.
 */
/**
 * Tamaño (pt) de la línea de método en el PDF. Más chica que los demás valores
 * (11 pt) porque la frase más larga de ADR-077 §4 ronda los 100 caracteres y
 * debe caber en el ancho útil de A4 (595 − 2×40 pt). `render-helpers.test.ts`
 * mide las seis frases canónicas con HelveticaBold al mismo tamaño.
 */
export const TAMANO_LINEA_METODO = 9;

/**
 * Línea de método del cert (ADR-077 §4/§5): la MISMA función pura que usa la
 * app (`lineaMetodoCertificacion`, carbon-calculator), adaptada a
 * `DatosMetricasCertificado`. `null` en certs legacy sin fuente de ruta o sin
 * cobertura: no se inventa método.
 */
export function lineaMetodoCert(m: {
  precisionMethod: DatosMetricasCertificado['precisionMethod'];
  routeDataSource?: DatosMetricasCertificado['routeDataSource'];
  coveragePct?: DatosMetricasCertificado['coveragePct'];
  glecVersion: string;
}): string | null {
  if (m.routeDataSource === undefined || m.coveragePct === undefined) {
    return null;
  }
  return lineaMetodoCertificacion({
    precisionMethod: m.precisionMethod,
    routeDataSource: m.routeDataSource,
    coveragePct: m.coveragePct,
    glecVersion: m.glecVersion,
  });
}

export function formatRouteDataSource(s: string): string {
  switch (s) {
    case 'teltonika_gps':
      return 'Telemetría Teltonika (GPS real)';
    case 'maps_directions':
      return 'Google Routes API (ruta modelada)';
    case 'manual_declared':
      return 'Declaración manual';
    case 'movil_gps':
      return 'GPS del celular del conductor (distancia medida)';
    default:
      return s;
  }
}
