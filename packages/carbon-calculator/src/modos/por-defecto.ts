import { DEFAULTS_POR_TIPO } from '../factores/defaults-por-tipo.js';
import { calcularModelado } from './modelado.js';
import type { ParametrosPorDefecto, ResultadoEmisiones } from '../tipos.js';

/**
 * Modo `por_defecto`: vehículo SIN perfil energético declarado.
 *
 * Estrategia: usar defaults conservadores por `tipo_vehiculo` y delegar
 * al cálculo `modelado`. Esto da un piso de emisiones que el carrier
 * puede mejorar declarando su perfil real (consumo, peso vacío, marca).
 *
 * Output: igual al modo `modelado`, pero el campo `metodoPrecision`
 * queda como `por_defecto` para que en reportes ESG sea trazable que
 * fue una estimación con datos de baja fidelidad.
 */
export function calcularPorDefecto(params: ParametrosPorDefecto): ResultadoEmisiones {
  const { distanciaKm, cargaKg, tipoVehiculo } = params;
  const defaults = DEFAULTS_POR_TIPO[tipoVehiculo];

  const resultado = calcularModelado({
    metodo: 'modelado',
    distanciaKm,
    cargaKg,
    vehiculo: {
      combustible: defaults.combustible,
      consumoBasePor100km: defaults.consumoBasePor100km,
      pesoVacioKg: null,
      capacidadKg: defaults.capacidadKg,
    },
  });

  // Override del método para reportar fidelity baja.
  return {
    ...resultado,
    metodoPrecision: 'por_defecto',
    fuenteFactores: `${resultado.fuenteFactores} (defaults para tipo: ${tipoVehiculo})`,
  };
}
