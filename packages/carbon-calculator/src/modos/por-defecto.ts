import { DEFAULTS_POR_TIPO } from '../factores/defaults-por-tipo.js';
import { categoriaVehiculo } from '../glec/factor-carga.js';
import type { ParametrosPorDefecto, ResultadoEmisiones } from '../tipos.js';
import { calcularModeladoConCategoria } from './modelado.js';

/**
 * Modo `por_defecto`: vehículo SIN perfil energético declarado.
 *
 * Estrategia: usar defaults conservadores por `tipo_vehiculo` y delegar
 * al cálculo `modelado`, pasando además la categoría GLEC (LDV/MDV/HDV)
 * derivada del tipo para calibrar el factor α de corrección de carga
 * (GLEC v3.0 §6.3, Tabla 6-3).
 *
 * Output: igual al modo `modelado`, pero el campo `metodoPrecision`
 * queda como `por_defecto` para que en reportes ESG sea trazable que
 * fue una estimación con datos de baja fidelidad.
 */
export function calcularPorDefecto(params: ParametrosPorDefecto): ResultadoEmisiones {
  const { distanciaKm, cargaKg, tipoVehiculo, backhaul } = params;
  const defaults = DEFAULTS_POR_TIPO[tipoVehiculo];
  const categoria = categoriaVehiculo(tipoVehiculo);

  const resultado = calcularModeladoConCategoria(
    {
      metodo: 'modelado',
      distanciaKm,
      cargaKg,
      vehiculo: {
        combustible: defaults.combustible,
        consumoBasePor100km: defaults.consumoBasePor100km,
        pesoVacioKg: null,
        capacidadKg: defaults.capacidadKg,
      },
      ...(backhaul !== undefined && { backhaul }),
    },
    categoria,
  );

  // Override del método para reportar fidelity baja.
  return {
    ...resultado,
    metodoPrecision: 'por_defecto',
    fuenteFactores: `${resultado.fuenteFactores} (defaults para tipo: ${tipoVehiculo})`,
  };
}
