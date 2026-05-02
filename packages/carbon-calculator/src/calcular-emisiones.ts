import { calcularExactoCanbus } from './modos/exacto-canbus.js';
import { calcularModelado } from './modos/modelado.js';
import { calcularPorDefecto } from './modos/por-defecto.js';
import type { ParametrosCalculo, ResultadoEmisiones } from './tipos.js';

/**
 * Entry point unificado del carbon-calculator.
 *
 * Despacha al modo correcto según `params.metodo`. Mantiene la API
 * estable para que el servicio orquestador (apps/api/src/services/
 * calcular-metricas-viaje.ts) pueda llamar a una sola función sin
 * preocuparse por las branches.
 *
 * Ejemplo:
 *
 *   const resultado = calcularEmisionesViaje({
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
 *
 *   resultado.emisionesKgco2eWtw    // ~390 kg CO2e
 *   resultado.intensidadGco2ePorTonKm // ~93 g/(t·km)
 */
export function calcularEmisionesViaje(params: ParametrosCalculo): ResultadoEmisiones {
  switch (params.metodo) {
    case 'exacto_canbus':
      return calcularExactoCanbus(params);
    case 'modelado':
      return calcularModelado(params);
    case 'por_defecto':
      return calcularPorDefecto(params);
    default: {
      // Exhaustiveness check.
      const _never: never = params;
      throw new Error(`Modo desconocido: ${JSON.stringify(_never)}`);
    }
  }
}
