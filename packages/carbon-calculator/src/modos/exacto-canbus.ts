import { obtenerFactorEmision } from '../factores/sec-chile-2024.js';
import { calcularEmptyBackhaul } from '../glec/empty-backhaul.js';
import type { CategoriaVehiculo } from '../glec/factor-carga.js';
import type { ParametrosExactoCanbus, ResultadoEmisiones } from '../tipos.js';

/**
 * Modo `exacto_canbus`: cálculo con telemetría real del Teltonika.
 *
 * Inputs (todos REALES, leídos del CAN-BUS):
 *   - distanciaKm: GPS real recorrido por el vehículo.
 *   - combustibleConsumido: en la unidad del combustible (L para
 *     diésel/gasolina/GLP, m3 para GNC, kWh para eléctrico, kg para H2).
 *     Leído del odómetro de combustible CAN-BUS o derivado de
 *     totalizadores de RPM/MAF.
 *   - cargaKg: lo que se transportó realmente.
 *   - backhaul (opcional): atribución del leg vacío de retorno (GLEC §6.4).
 *
 * Lógica:
 *   - NO aplicamos corrección por carga al loaded leg porque ya está
 *     implícita en el consumo real medido.
 *   - emisionesWtw = combustibleConsumido × factorWtw(combustible)
 *   - Si hay backhaul, el leg vacío sí se modela (no tenemos telemetría
 *     del retorno todavía cuando se calcula el shipment original).
 *
 * Esto da la mejor precisión porque tanto distancia como consumo son
 * mediciones reales del vehículo. La incertidumbre principal pasa al
 * factor de emisión upstream (WTT) que sigue siendo un valor referencia.
 */
export function calcularExactoCanbus(
  params: ParametrosExactoCanbus,
  categoria?: CategoriaVehiculo,
): ResultadoEmisiones {
  const { distanciaKm, combustibleConsumido, cargaKg, vehiculo, backhaul } = params;

  if (distanciaKm < 0) {
    throw new Error('distanciaKm debe ser >= 0');
  }
  if (combustibleConsumido < 0) {
    throw new Error('combustibleConsumido debe ser >= 0');
  }
  if (cargaKg < 0) {
    throw new Error('cargaKg debe ser >= 0');
  }

  const factor = obtenerFactorEmision(vehiculo.combustible);
  const factorWtw = factor.ttwKgco2e + factor.wttKgco2e;

  const emisionesTtw = combustibleConsumido * factor.ttwKgco2e;
  const emisionesWtt = combustibleConsumido * factor.wttKgco2e;
  const emisionesWtw = combustibleConsumido * factorWtw;

  const cargaTon = cargaKg / 1000;
  const intensidad =
    cargaTon > 0 && distanciaKm > 0 ? (emisionesWtw * 1000) / (distanciaKm * cargaTon) : 0;

  const resultado: ResultadoEmisiones = {
    emisionesKgco2eWtw: round3(emisionesWtw),
    emisionesKgco2eTtw: round3(emisionesTtw),
    emisionesKgco2eWtt: round3(emisionesWtt),
    combustibleConsumido: round2(combustibleConsumido),
    unidadCombustible: factor.unidad,
    distanciaKm: round2(distanciaKm),
    intensidadGco2ePorTonKm: round2(intensidad),
    metodoPrecision: 'exacto_canbus',
    factorEmisionUsado: round5(factorWtw),
    versionGlec: 'v3.0',
    fuenteFactores: factor.fuente,
  };

  if (backhaul && cargaTon > 0 && distanciaKm > 0 && vehiculo.consumoBasePor100km != null) {
    const empty = calcularEmptyBackhaul({
      distanciaRetornoKm: backhaul.distanciaRetornoKm,
      factorMatching: backhaul.factorMatching,
      consumoBasePor100km: vehiculo.consumoBasePor100km,
      combustible: vehiculo.combustible,
      capacidadKg: vehiculo.capacidadKg,
      ...(categoria !== undefined && { categoria }),
    });
    const emisionesTotalesWtw = emisionesWtw + empty.emisionesKgco2eWtw;
    const intensidadConBackhaul = (emisionesTotalesWtw * 1000) / (distanciaKm * cargaTon);
    resultado.backhaul = {
      emisionesKgco2eWtw: empty.emisionesKgco2eWtw,
      intensidadConBackhaulGco2ePorTonKm: round2(intensidadConBackhaul),
      ahorroVsSinMatchingKgco2e: empty.ahorroVsSinMatchingKgco2e,
      factorMatchingAplicado: round2(backhaul.factorMatching),
    };
  }

  return resultado;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
function round5(n: number): number {
  return Math.round(n * 100000) / 100000;
}
