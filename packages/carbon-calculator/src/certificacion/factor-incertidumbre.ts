import type { NivelCertificacion } from '../tipos.js';
import { THRESHOLD_PRIMARIO_PCT } from './derivar-nivel.js';

/**
 * Factor de incertidumbre baseline por nivel de certificación, según la
 * tabla de ADR-028 §3. Los valores tienen fundamento en:
 *
 *   - ISO 14083 §5.2 — data quality default tier para servicios de
 *     transporte de carga.
 *   - GLEC Framework v3.0 Annex B — recommended uncertainty ranges by
 *     data tier.
 *   - DEFRA UK 2024 — uncertainty bands para emission factors por
 *     country/fuel.
 *
 * Cualquier cambio a estos valores requiere ADR adicional.
 */
const BASELINE_POR_NIVEL: Readonly<Record<NivelCertificacion, number>> = {
  primario_verificable: 0.05,
  secundario_modeled: 0.15,
  secundario_default: 0.3,
};

/**
 * Calcula el factor de incertidumbre publicado en el certificado de
 * huella de carbono (ADR-028 §3). Es el ± que se imprime visiblemente
 * en el cert: "12.4 ± 0.6 kg CO₂e con α = 0.05".
 *
 * Función PURA. Recibe el nivel ya derivado + modificadores específicos
 * por nivel y retorna el factor final cap-eado a 1.0.
 *
 * Modificadores por nivel (ADR-028 §3 tabla):
 *
 *   - **primario_verificable** (baseline 0.05):
 *     +0.01 si el CAN bus reporta una desviación > 5% respecto al perfil
 *     declarado del vehículo (signal de potencial mal calibración del
 *     bus o perfil energético desactualizado).
 *
 *   - **secundario_modeled** (baseline 0.15):
 *     + (1 − coverage_pct/100) × 0.20 si la cobertura cayó por debajo
 *     del threshold primario (95%). Linealmente proporcional al hueco.
 *     Ejemplo: cobertura 70% → +0.06 → factor total 0.21.
 *
 *   - **secundario_default** (baseline 0.30):
 *     +0.10 si el tipo de vehículo declarado no matchea el `vehicleInfo`
 *     pasado a Routes API (mismatch en categoría LDV/MDV/HDV).
 *
 * @example
 * ```ts
 * calcularFactorIncertidumbre({
 *   nivelCertificacion: 'primario_verificable',
 *   canbusDeviationPct: 3,  // dentro del 5%, no penaliza
 *   coveragePct: 98,
 *   vehicleTypeMatchesRoutesApi: true,
 * }); // → 0.05
 *
 * calcularFactorIncertidumbre({
 *   nivelCertificacion: 'secundario_modeled',
 *   coveragePct: 70,
 *   vehicleTypeMatchesRoutesApi: true,
 * }); // → 0.15 + (1 - 0.7) * 0.2 = 0.21
 * ```
 */
export function calcularFactorIncertidumbre(input: {
  nivelCertificacion: NivelCertificacion;
  /**
   * Desviación porcentual entre consumo CAN bus y consumo del perfil
   * declarado del vehículo. Solo aplica para `primario_verificable`. Si
   * `undefined`, no se aplica el modificador (asumimos que no se midió).
   */
  canbusDeviationPct?: number | undefined;
  /** Cobertura del trip por la fuente principal, [0..100]. */
  coveragePct: number;
  /**
   * `true` si el tipo de vehículo declarado matchea exactamente el
   * `vehicleInfo` pasado a Routes API. Solo aplica para `secundario_default`.
   */
  vehicleTypeMatchesRoutesApi: boolean;
}): number {
  const { nivelCertificacion, canbusDeviationPct, coveragePct, vehicleTypeMatchesRoutesApi } =
    input;

  if (coveragePct < 0 || coveragePct > 100 || Number.isNaN(coveragePct)) {
    throw new Error(`coveragePct debe estar en [0, 100], recibido ${coveragePct} (ADR-028 §3)`);
  }

  let factor = BASELINE_POR_NIVEL[nivelCertificacion];

  switch (nivelCertificacion) {
    case 'primario_verificable':
      if (canbusDeviationPct !== undefined && canbusDeviationPct > 5) {
        factor += 0.01;
      }
      break;
    case 'secundario_modeled':
      if (coveragePct < THRESHOLD_PRIMARIO_PCT) {
        factor += (1 - coveragePct / 100) * 0.2;
      }
      break;
    case 'secundario_default':
      if (!vehicleTypeMatchesRoutesApi) {
        factor += 0.1;
      }
      break;
  }

  // Cap en 1.0 — un factor > 1.0 no tiene interpretación física.
  return Math.min(factor, 1);
}
