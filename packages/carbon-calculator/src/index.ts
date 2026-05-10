/**
 * @booster-ai/carbon-calculator
 *
 * Cálculo de huella de carbono de viajes según **GLEC Framework v3.0**
 * (Smart Freight Centre 2023) + **IPCC AR6 GWP-100**, con factores de
 * emisión Chile (SEC + MMA + CEN) año 2024.
 *
 * Ver `docs/adr/021-glec-v3-compliance.md` para la decisión arquitectónica
 * y `docs/research/013-glec-audit.md` para la auditoría que la motivó.
 *
 * 3 modos de precisión (espejo del enum `metodo_precision` del schema):
 *   - **exacto_canbus**: telemetría real del Teltonika (consumo CAN-BUS).
 *   - **modelado**: distancia Google Maps + perfil energético declarado.
 *   - **por_defecto**: defaults por tipo de vehículo si no hay perfil.
 *
 * Funcionalidad GLEC v3.0 implementada:
 *   - **§6.3**: corrección de consumo por carga, con α calibrado por
 *     categoría LDV/MDV/HDV.
 *   - **§6.4**: empty backhaul allocation. Atribuye al shipment las
 *     emisiones del leg vacío de retorno, descontando lo que el matching
 *     de Booster cubrió. Diferenciador comercial central.
 *
 * API pública (todo PURO, sin I/O):
 *
 *     import { calcularEmisionesViaje } from '@booster-ai/carbon-calculator';
 *
 *     const r = calcularEmisionesViaje({
 *       metodo: 'modelado',
 *       distanciaKm: 350,
 *       cargaKg: 12000,
 *       vehiculo: {
 *         combustible: 'diesel',
 *         consumoBasePor100km: 28,
 *         pesoVacioKg: 8000,
 *         capacidadKg: 25000,
 *       },
 *       backhaul: {
 *         distanciaRetornoKm: 350,
 *         factorMatching: 0.7,  // Booster encontró carga para 70% del retorno
 *       },
 *     });
 *
 *     r.emisionesKgco2eWtw                          // loaded leg
 *     r.backhaul?.emisionesKgco2eWtw                // empty leg attributable
 *     r.backhaul?.ahorroVsSinMatchingKgco2e         // ahorro vía matching
 *     r.backhaul?.intensidadConBackhaulGco2ePorTonKm  // KPI completo
 */

export { calcularEmisionesViaje } from './calcular-emisiones.js';
export { calcularExactoCanbus } from './modos/exacto-canbus.js';
export { calcularModelado } from './modos/modelado.js';
export { calcularPorDefecto } from './modos/por-defecto.js';
export { obtenerFactorEmision, factorWtw } from './factores/sec-chile-2024.js';
export { DEFAULTS_POR_TIPO } from './factores/defaults-por-tipo.js';
export {
  calcularFactorCorreccionPorCarga,
  categoriaVehiculo,
  type CategoriaVehiculo,
} from './glec/factor-carga.js';
export {
  calcularEmptyBackhaul,
  type ParametrosEmptyBackhaul,
  type ResultadoEmptyBackhaul,
} from './glec/empty-backhaul.js';
export type {
  TipoCombustible,
  MetodoPrecision,
  FactorEmisionCombustible,
  PerfilVehiculo,
  ParametrosBackhaul,
  ParametrosModelado,
  ParametrosExactoCanbus,
  ParametrosPorDefecto,
  ParametrosCalculo,
  ResultadoEmisiones,
} from './tipos.js';
