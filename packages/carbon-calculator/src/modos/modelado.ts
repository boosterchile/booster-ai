import { obtenerFactorEmision } from '../factores/sec-chile-2024.js';
import { calcularFactorCorreccionPorCarga } from '../glec/factor-carga.js';
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
 *
 * Lógica:
 *   1. consumoReal = consumoBase × correccionPorCarga
 *   2. consumoTotal = consumoReal × (distanciaKm / 100)
 *   3. emisionesWtw = consumoTotal × factorWtw(combustible)
 *   4. intensidad = emisionesWtw / (distanciaKm × cargaTon)
 */
export function calcularModelado(params: ParametrosModelado): ResultadoEmisiones {
  const { distanciaKm, cargaKg, vehiculo } = params;

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
  });
  const consumoPor100km = vehiculo.consumoBasePor100km * correccion;
  const consumoTotal = consumoPor100km * (distanciaKm / 100);

  const emisionesTtw = consumoTotal * factor.ttwKgco2e;
  const emisionesWtt = consumoTotal * factor.wttKgco2e;
  const emisionesWtw = consumoTotal * factorWtw;

  const cargaTon = cargaKg / 1000;
  const intensidad = cargaTon > 0 && distanciaKm > 0 ? (emisionesWtw * 1000) / (distanciaKm * cargaTon) : 0;

  return {
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
