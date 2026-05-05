import { obtenerFactorEmision } from '../factores/sec-chile-2024.js';
import { calcularEmptyBackhaul } from '../glec/empty-backhaul.js';
import { type CategoriaVehiculo, calcularFactorCorreccionPorCarga } from '../glec/factor-carga.js';
import type { ParametrosModelado, ResultadoEmisiones } from '../tipos.js';

/**
 * Modo `modelado`: cálculo sin telemetría real.
 *
 * Inputs:
 *   - distanciaKm: planificada (Google Maps Routes API).
 *   - cargaKg: la que el shipper declaró en la solicitud del viaje.
 *   - vehiculo.consumoBasePor100km: declarado por el carrier en
 *     onboarding. Si null → no se puede usar este modo (usar
 *     `por_defecto` que cae sobre defaults por tipo de vehículo).
 *   - backhaul: opcional, GLEC v3.0 §6.4. Si está, se calcula la
 *     atribución del leg vacío de retorno usando el factor de
 *     matching real conseguido por Booster.
 *
 * Lógica del leg loaded (siempre):
 *   1. consumoReal = consumoBase × correccionPorCarga (GLEC §6.3, α=0.10 default)
 *   2. consumoTotal = consumoReal × (distanciaKm / 100)
 *   3. emisionesWtw = consumoTotal × factorWtw(combustible)
 *   4. intensidad = emisionesWtw × 1000 / (distanciaKm × cargaTon)
 *
 * Lógica del leg vacío (si `backhaul` presente):
 *   5. emisionesEmpty = empty-backhaul(distanciaRetorno, factorMatching, ...)
 *   6. intensidadConBackhaul = (emisionesWtw + emisionesEmpty) × 1000 / (distanciaKm × cargaTon)
 */
export function calcularModelado(params: ParametrosModelado): ResultadoEmisiones {
  return calcularModeladoConCategoria(params);
}

/**
 * Variante interna: acepta categoría explícita para que `por-defecto`
 * pueda pasar la categoría que ya conoce sin re-mapear desde
 * tipoVehiculo. Si no se pasa, default 'MDV' (compat legacy).
 */
export function calcularModeladoConCategoria(
  params: ParametrosModelado,
  categoria?: CategoriaVehiculo,
): ResultadoEmisiones {
  const { distanciaKm, cargaKg, vehiculo, backhaul } = params;

  if (vehiculo.consumoBasePor100km == null) {
    throw new Error(
      'modo modelado requiere consumoBasePor100km en el perfil del vehículo. Usa modo por_defecto si no está disponible.',
    );
  }
  if (distanciaKm < 0) {
    throw new Error('distanciaKm debe ser >= 0');
  }
  if (cargaKg < 0) {
    throw new Error('cargaKg debe ser >= 0');
  }

  const factor = obtenerFactorEmision(vehiculo.combustible);
  const factorWtw = factor.ttwKgco2e + factor.wttKgco2e;

  const correccion = calcularFactorCorreccionPorCarga({
    cargaKg,
    capacidadKg: vehiculo.capacidadKg,
    ...(categoria !== undefined && { categoria }),
  });
  const consumoPor100km = vehiculo.consumoBasePor100km * correccion;
  const consumoTotal = consumoPor100km * (distanciaKm / 100);

  const emisionesTtw = consumoTotal * factor.ttwKgco2e;
  const emisionesWtt = consumoTotal * factor.wttKgco2e;
  const emisionesWtw = consumoTotal * factorWtw;

  const cargaTon = cargaKg / 1000;
  const intensidad =
    cargaTon > 0 && distanciaKm > 0 ? (emisionesWtw * 1000) / (distanciaKm * cargaTon) : 0;

  const resultado: ResultadoEmisiones = {
    emisionesKgco2eWtw: round3(emisionesWtw),
    emisionesKgco2eTtw: round3(emisionesTtw),
    emisionesKgco2eWtt: round3(emisionesWtt),
    combustibleConsumido: round2(consumoTotal),
    unidadCombustible: factor.unidad,
    distanciaKm: round2(distanciaKm),
    intensidadGco2ePorTonKm: round2(intensidad),
    metodoPrecision: 'modelado',
    factorEmisionUsado: round5(factorWtw),
    versionGlec: 'v3.0',
    fuenteFactores: factor.fuente,
  };

  if (backhaul && cargaTon > 0 && distanciaKm > 0) {
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
