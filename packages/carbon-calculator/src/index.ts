/**
 * @booster-ai/carbon-calculator
 *
 * Cálculo de huella de carbono de viajes según GLEC Framework v3.0,
 * con factores de emisión Chile (SEC + MMA + CEN) año 2024.
 *
 * 3 modos de precisión (espejo del enum `metodo_precision` del schema):
 *   - exacto_canbus: telemetría real del Teltonika (consumo CAN-BUS).
 *   - modelado:      distancia Google Maps + perfil energético declarado.
 *   - por_defecto:   defaults por tipo de vehículo si no hay perfil.
 *
 * API pública (todo PURO, sin I/O):
 *
 *   import { calcularEmisionesViaje } from '@booster-ai/carbon-calculator';
 *
 *   const r = calcularEmisionesViaje({
 *     metodo: 'modelado',
 *     distanciaKm: 350,
 *     cargaKg: 12000,
 *     vehiculo: {
 *       combustible: 'diesel',
 *       consumoBasePor100km: 28,
 *       pesoVacioKg: 8000,
 *       capacidadKg: 25000,
 *     },
 *   });
 */

export { calcularEmisionesViaje } from './calcular-emisiones.js';
export { calcularExactoCanbus } from './modos/exacto-canbus.js';
export { calcularModelado } from './modos/modelado.js';
export { calcularPorDefecto } from './modos/por-defecto.js';
export { obtenerFactorEmision, factorWtw } from './factores/sec-chile-2024.js';
export { DEFAULTS_POR_TIPO } from './factores/defaults-por-tipo.js';
export { calcularFactorCorreccionPorCarga } from './glec/factor-carga.js';
export type {
  TipoCombustible,
  MetodoPrecision,
  FactorEmisionCombustible,
  PerfilVehiculo,
  ParametrosModelado,
  ParametrosExactoCanbus,
  ParametrosPorDefecto,
  ParametrosCalculo,
  ResultadoEmisiones,
} from './tipos.js';
