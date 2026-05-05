import type { FactorEmisionCombustible, TipoCombustible } from '../tipos.js';

/**
 * Factores de emisión Well-to-Wheel para Chile, año 2024.
 *
 * **Versión 2 (2026-05-05)**: ajustados a GLEC Framework v3.0 + IPCC AR6
 * GWP-100 tras audit FIX-013 (ver `docs/research/013-glec-audit.md` y
 * `docs/adr/016-glec-v3-compliance.md`).
 *
 * Fuentes:
 *   - **GLEC Framework v3.0** (Smart Freight Centre, 2023). Annex A1/A2
 *     para WTT y densidades energéticas. Vía Climatiq dataset oficial.
 *     <https://www.smartfreightcentre.org/en/our-programs/emissions-accounting/global-logistics-emissions-council/>
 *   - **IPCC AR6 WG1** (2021), Tabla 7.SM.7 — GWP-100 values:
 *     CO₂ = 1 · CH₄ (fósil) = 29.8 · N₂O = 273.
 *     <https://www.ipcc.ch/report/ar6/wg1/downloads/report/IPCC_AR6_WGI_Chapter_07_Supplementary_Material.pdf>
 *   - **DEFRA UK 2024 GHG Conversion Factors** (cross-check de WTW EU).
 *     <https://www.gov.uk/government/publications/greenhouse-gas-reporting-conversion-factors-2024>
 *   - **Decreto Supremo N°60/2010 Chile** (B5 mandatorio + actualizaciones).
 *   - **CEN — Coordinador Eléctrico Nacional** Reporte Anual factor SEN.
 *
 * Política de actualización:
 *   - Revisar anualmente (Q1) — comparar con publicaciones nuevas SEC/MMA
 *     y CEN, actualizar `anioReferencia` en cada cambio.
 *   - Híbridos: el factor depende del split eléctrico/combustión real,
 *     que varía por modelo. Usamos un proxy conservador (~70% del
 *     factor del combustible puro). Cuando un cliente declare modelo
 *     específico, podemos override con valor de fabricante.
 *
 * **Importante — sobre el TTW**: el cálculo CO₂e_combustible incluye
 * **CO₂ + CH₄ + N₂O ponderados con IPCC AR6 GWP-100**. NO incluye NOx,
 * SOx, MP — esos son contaminantes locales, no GHG. Cita estequiométrica:
 *   - 1 L diésel ≈ 0.86 kg de carbono (densidad 0.84 kg/L × 86% C).
 *   - Combustión completa: 0.86 × 44/12 = **2.68 kg CO₂/L** (puro CO₂).
 *   - + CH₄ ~0.0001 kg/L × GWP 29.8 = ~0.003 kg CO₂e/L.
 *   - + N₂O ~0.00007 kg/L × GWP 273 = ~0.019 kg CO₂e/L.
 *   - **Total TTW: 2.70 kg CO₂e/L** (consenso GLEC/EPA/EEA).
 */

const FUENTE_GLEC = 'GLEC v3.0 (Smart Freight Centre 2023) + IPCC AR6 GWP-100';
const FUENTE_CEN = 'CEN Chile 2024 (factor SEN anual) + GLEC v3.0 EU defaults';

/**
 * Mapa principal de factores. Las funciones `obtenerFactorEmision()` y
 * `factorWtw()` exponen el lookup typesafe.
 */
const FACTORES_SEC_CHILE_2024: Readonly<Record<TipoCombustible, FactorEmisionCombustible>> = {
  // ──────────────────────────────────────────────────────────────────────────
  // Diésel B5 (5% biodiésel mandatorio en Chile desde Decreto N°60/2010)
  //
  // TTW: 2.70 = 2.68 (CO₂ puro combustión) + 0.02 (CH₄ + N₂O × GWP-100 AR6).
  //   Antes era 3.16 — incluía NOx por error (NOx no es GHG).
  // WTT: 0.55 — extracción + refinería + transporte + 5% blend biodiésel.
  //   Antes era 0.61 — al límite alto del rango GLEC EU/Chile (0.50-0.58).
  // WTW total: 3.25 (vs 3.77 antes; -13.8%).
  //   Climatiq GLEC EU diesel WTW = 3.24; convergencia ✓.
  // ──────────────────────────────────────────────────────────────────────────
  diesel: {
    combustible: 'diesel',
    ttwKgco2e: 2.7,
    wttKgco2e: 0.55,
    energyMjPerUnit: 36.0, // LHV diésel
    unidad: 'L',
    anioReferencia: 2024,
    fuente: FUENTE_GLEC,
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Gasolina (93/95/97 octanos — diferencias en CO₂e despreciables)
  //
  // TTW: 2.31 = 2.29 (CO₂ puro) + 0.02 (CH₄ + N₂O AR6). Antes 2.35.
  // WTT: 0.45 — alineado GLEC EU. Antes 0.49.
  // ──────────────────────────────────────────────────────────────────────────
  gasolina: {
    combustible: 'gasolina',
    ttwKgco2e: 2.31,
    wttKgco2e: 0.45,
    energyMjPerUnit: 32.2,
    unidad: 'L',
    anioReferencia: 2024,
    fuente: FUENTE_GLEC,
  },

  // ──────────────────────────────────────────────────────────────────────────
  // GLP (gas licuado de petróleo, propano + butano)
  // ──────────────────────────────────────────────────────────────────────────
  gas_glp: {
    combustible: 'gas_glp',
    ttwKgco2e: 1.61, // antes 1.66
    wttKgco2e: 0.3, // antes 0.34
    energyMjPerUnit: 25.7,
    unidad: 'L',
    anioReferencia: 2024,
    fuente: FUENTE_GLEC,
  },

  // ──────────────────────────────────────────────────────────────────────────
  // GNC (gas natural comprimido) — medido en m³ STD (0 °C, 1 atm)
  // ──────────────────────────────────────────────────────────────────────────
  gas_gnc: {
    combustible: 'gas_gnc',
    ttwKgco2e: 2.05, // antes 2.13
    wttKgco2e: 0.36, // antes 0.40
    energyMjPerUnit: 38.0,
    unidad: 'm3',
    anioReferencia: 2024,
    fuente: FUENTE_GLEC,
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Eléctrico — factor del SEN Chile.
  // El factor se actualiza anualmente; el mix renovable de Chile creció
  // mucho 2020-2024 (ERNC > 35% y subiendo), bajando este factor año a año.
  // Verificar anualmente con CEN para mantener veracidad del cálculo.
  // ──────────────────────────────────────────────────────────────────────────
  electrico: {
    combustible: 'electrico',
    ttwKgco2e: 0.0, // sin combustión local
    wttKgco2e: 0.34, // generación eléctrica + transmisión + carga (Chile 2024)
    energyMjPerUnit: 3.6, // 1 kWh = 3.6 MJ
    unidad: 'kWh',
    anioReferencia: 2024,
    fuente: FUENTE_CEN,
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Híbridos — proxy conservador 70% del factor del combustible puro.
  // El split real depende del modelo, modo de uso (urbano vs ruta),
  // y carga. Cuando un cliente declare modelo específico podemos
  // override con datos del fabricante. Política: re-calibrar cuando
  // tengamos N>=10 viajes con telemetría real por modelo de híbrido.
  // ──────────────────────────────────────────────────────────────────────────
  hibrido_diesel: {
    combustible: 'hibrido_diesel',
    ttwKgco2e: 2.7 * 0.7, // = 1.89
    wttKgco2e: 0.55 * 0.7, // = 0.385
    energyMjPerUnit: 36.0,
    unidad: 'L',
    anioReferencia: 2024,
    fuente: `${FUENTE_GLEC} (proxy 70% vs diésel puro)`,
  },

  hibrido_gasolina: {
    combustible: 'hibrido_gasolina',
    ttwKgco2e: 2.31 * 0.7, // = 1.617
    wttKgco2e: 0.45 * 0.7, // = 0.315
    energyMjPerUnit: 32.2,
    unidad: 'L',
    anioReferencia: 2024,
    fuente: `${FUENTE_GLEC} (proxy 70% vs gasolina pura)`,
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Hidrógeno — asumimos H₂ GRIS (steam methane reforming) que es el
  // mayoritario en el mercado actual. Cuando exista tracking de H₂ verde
  // certificado (electrólisis con renovables), se puede agregar variante.
  // ──────────────────────────────────────────────────────────────────────────
  hidrogeno: {
    combustible: 'hidrogeno',
    ttwKgco2e: 0.0, // combustión a vapor de agua
    wttKgco2e: 10.0, // SMR genera ~10 kg CO₂e/kg H₂
    energyMjPerUnit: 120.0, // LHV H₂
    unidad: 'kg',
    anioReferencia: 2024,
    fuente: 'GLEC v3.0 (asumiendo H₂ gris SMR; H₂ verde requiere certificación específica)',
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
