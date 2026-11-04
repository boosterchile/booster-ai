/**
 * Referencia HuellaChile 2025 (MMA) para el diésel — SOLO referencia en el
 * certificado (HC-004 ux.md §14); el cálculo principal sigue con GLEC.
 * Fuente: «Factores de emisión 2025 Org y Ev v2» (versión resumen), MMA:
 *   - TTW combustión móvil diésel 2,740 kg CO₂e/L (IPCC 2006 + CNE BNE 2024);
 *   - WTT diésel (cat. 3.1) 0,624 kg CO₂e/L (DEFRA 2025 WTT-fuels).
 * https://huellachile.mma.gob.cl/wp-content/uploads/2026/05/HuellaChile-Factores-de-emision2025_-Org-y-Ev_v2-Version-resumen.xlsx
 */
export const REFERENCIA_HUELLACHILE_2025 = {
  ttwKgco2ePorL: 2.74,
  wttKgco2ePorL: 0.624,
  fuente: 'HuellaChile 2025, MMA',
} as const;

/** Combustibles cuyos litros son diésel: la referencia por litro aplica. */
export const COMBUSTIBLES_REFERENCIA_HUELLACHILE = new Set(['diesel', 'hibrido_diesel']);
