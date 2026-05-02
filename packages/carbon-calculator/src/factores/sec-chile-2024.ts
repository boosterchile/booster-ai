import type { FactorEmisionCombustible, TipoCombustible } from '../tipos.js';

/**
 * Factores de emisión Well-to-Wheel para Chile, año 2024.
 *
 * Fuentes:
 *   - SEC (Superintendencia de Electricidad y Combustibles) - resoluciones
 *     anuales sobre composición de combustibles y blends obligatorios
 *     (Decreto Supremo N°60/2010 y actualizaciones).
 *   - MMA (Ministerio del Medio Ambiente) - factores de emisión guía
 *     RETC para inventarios corporativos.
 *   - GLEC Framework v3.0 (Smart Freight Centre, 2023) Annex Tables A1/A2
 *     para densidades energéticas y referencias internacionales WTT.
 *   - CEN (Coordinador Eléctrico Nacional) Reporte Anual 2024 - factor
 *     de emisión del SEN (Sistema Eléctrico Nacional).
 *
 * Política de actualización:
 *   - Revisar anualmente (Q1) — comparar con publicaciones nuevas SEC/MMA
 *     y CEN, actualizar `anioReferencia` en cada cambio.
 *   - Híbridos: el factor depende del split eléctrico/combustión real,
 *     que varía por modelo. Usamos un proxy conservador (≈ 70% del
 *     factor del combustible puro). Cuando un cliente declare modelo
 *     específico, podemos override con valor de fabricante.
 *
 * Importante: TODOS los valores incluyen CO2 + CH4 + N2O ponderados
 * vía GWP-100 (IPCC AR6). Por eso son CO2-equivalentes (CO2e).
 *
 * Conversión TTW: 1 L diésel ≈ 2.68 kg CO2 puro. Sumando CH4/N2O
 * (combustión incompleta + óxidos de nitrógeno) llegamos a ~3.16
 * kgCO2e/L que es el valor consensuado para diésel B5 chileno.
 */

const FUENTE_SEC = 'SEC Chile 2024 + GLEC v3.0';
const FUENTE_CEN = 'CEN Chile 2024 (factor SEN anual)';

/**
 * Mapa principal de factores. Las funciones `getFactor()` y
 * `obtenerFactorEmision()` exponen el lookup typesafe.
 */
const FACTORES_SEC_CHILE_2024: Readonly<Record<TipoCombustible, FactorEmisionCombustible>> = {
  // ──────────────────────────────────────────────────────────────────────────
  // Diésel B5 (5 % biodiésel mandatorio en Chile desde Decreto N°60/2010)
  // ──────────────────────────────────────────────────────────────────────────
  diesel: {
    combustible: 'diesel',
    ttwKgco2e: 3.16, // combustión: CO2 + CH4 + N2O equivalentes
    wttKgco2e: 0.61, // upstream: extracción + refinería + transporte + 5 % biodiésel
    energyMjPerUnit: 36.0, // LHV diésel
    unidad: 'L',
    anioReferencia: 2024,
    fuente: FUENTE_SEC,
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Gasolina (93/95/97 octanos — diferencias en CO2e despreciables)
  // ──────────────────────────────────────────────────────────────────────────
  gasolina: {
    combustible: 'gasolina',
    ttwKgco2e: 2.35,
    wttKgco2e: 0.49,
    energyMjPerUnit: 32.2,
    unidad: 'L',
    anioReferencia: 2024,
    fuente: FUENTE_SEC,
  },

  // ──────────────────────────────────────────────────────────────────────────
  // GLP (gas licuado de petróleo, propano + butano)
  // ──────────────────────────────────────────────────────────────────────────
  gas_glp: {
    combustible: 'gas_glp',
    ttwKgco2e: 1.66,
    wttKgco2e: 0.34,
    energyMjPerUnit: 25.7,
    unidad: 'L',
    anioReferencia: 2024,
    fuente: FUENTE_SEC,
  },

  // ──────────────────────────────────────────────────────────────────────────
  // GNC (gas natural comprimido) — medido en m³ STD (0 °C, 1 atm)
  // ──────────────────────────────────────────────────────────────────────────
  gas_gnc: {
    combustible: 'gas_gnc',
    ttwKgco2e: 2.13, // por m³ STD
    wttKgco2e: 0.4,
    energyMjPerUnit: 38.0,
    unidad: 'm3',
    anioReferencia: 2024,
    fuente: FUENTE_SEC,
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Eléctrico — factor del SEN Chile.
  // El factor se actualiza anualmente; el mix renovable de Chile creció
  // mucho 2020-2024 (ERNC > 35 % y subiendo), bajando este factor año a año.
  // Verificar anualmente con CEN para mantener veracidad del cálculo.
  // ──────────────────────────────────────────────────────────────────────────
  electrico: {
    combustible: 'electrico',
    ttwKgco2e: 0.0, // sin combustión local
    wttKgco2e: 0.34, // generación eléctrica + transmisión + carga
    energyMjPerUnit: 3.6, // 1 kWh = 3.6 MJ
    unidad: 'kWh',
    anioReferencia: 2024,
    fuente: FUENTE_CEN,
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Híbridos — proxy conservador 70 % del factor del combustible puro.
  // El split real depende del modelo, modo de uso (urbano vs ruta),
  // y carga. Cuando un cliente declare modelo específico podemos
  // override con datos del fabricante.
  // ──────────────────────────────────────────────────────────────────────────
  hibrido_diesel: {
    combustible: 'hibrido_diesel',
    ttwKgco2e: 3.16 * 0.7,
    wttKgco2e: 0.61 * 0.7,
    energyMjPerUnit: 36.0,
    unidad: 'L',
    anioReferencia: 2024,
    fuente: `${FUENTE_SEC} (proxy 70 % vs diésel puro)`,
  },

  hibrido_gasolina: {
    combustible: 'hibrido_gasolina',
    ttwKgco2e: 2.35 * 0.7,
    wttKgco2e: 0.49 * 0.7,
    energyMjPerUnit: 32.2,
    unidad: 'L',
    anioReferencia: 2024,
    fuente: `${FUENTE_SEC} (proxy 70 % vs gasolina pura)`,
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Hidrógeno — asumimos H2 GRIS (steam methane reforming) que es el
  // mayoritario en el mercado actual. Cuando exista tracking de H2 verde
  // certificado (electrólisis con renovables), se puede agregar variante.
  // ──────────────────────────────────────────────────────────────────────────
  hidrogeno: {
    combustible: 'hidrogeno',
    ttwKgco2e: 0.0, // combustión a vapor de agua
    wttKgco2e: 10.0, // SMR (steam methane reforming) genera ~10 kg CO2e/kg H2
    energyMjPerUnit: 120.0, // LHV H2
    unidad: 'kg',
    anioReferencia: 2024,
    fuente: 'GLEC v3.0 (asumiendo H2 gris SMR; H2 verde requiere certificación específica)',
  },
};

/**
 * Lookup typesafe de factor por combustible. Devuelve una copia
 * inmutable; el caller no debe mutarla.
 */
export function obtenerFactorEmision(combustible: TipoCombustible): FactorEmisionCombustible {
  return { ...FACTORES_SEC_CHILE_2024[combustible] };
}

/**
 * Devuelve el WTW (Well-to-Wheel) en una sola línea.
 * `wtw = ttw + wtt`. Conveniente para la mayoría de cálculos.
 */
export function factorWtw(combustible: TipoCombustible): number {
  const f = FACTORES_SEC_CHILE_2024[combustible];
  return f.ttwKgco2e + f.wttKgco2e;
}
