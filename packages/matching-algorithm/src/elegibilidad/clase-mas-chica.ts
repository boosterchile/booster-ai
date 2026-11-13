import type { RequisitosDeCarga, TipoDeUnidad } from './configuraciones.js';
import { configuracionesElegibles } from './configuraciones.js';
import { DEFAULTS_POR_TIPO_CAPACIDAD } from './defaults-clase.js';
import type { Carroceria } from './tabla.js';

/**
 * Catálogo de clases por defecto para estimar huella sin vehículo declarado
 * (matching-desde-la-carga §3.12). Cada entrada es una motriz virtual con la
 * capacidad y carrocería típicas del tipo legacy; se elige la de menor
 * capacidad útil que cumple §3.3.
 */
export type ClaseVehiculoPorDefecto = keyof typeof DEFAULTS_POR_TIPO_CAPACIDAD;

interface ClaseCatalogo {
  readonly tipoVehiculo: ClaseVehiculoPorDefecto;
  readonly unitType: TipoDeUnidad;
  readonly bodyType: Carroceria | null;
  readonly capacityKg: number;
}

const CATALOGO: readonly ClaseCatalogo[] = (
  Object.entries(DEFAULTS_POR_TIPO_CAPACIDAD) as Array<
    [
      ClaseVehiculoPorDefecto,
      { capacityKg: number; unitType: TipoDeUnidad; bodyType: Carroceria | null },
    ]
  >
)
  .map(([tipoVehiculo, perfil]) => ({
    tipoVehiculo,
    unitType: perfil.unitType,
    bodyType: perfil.bodyType,
    capacityKg: perfil.capacityKg,
  }))
  .sort((a, b) => a.capacityKg - b.capacityKg || a.tipoVehiculo.localeCompare(b.tipoVehiculo));

/**
 * Clase de vehículo más chica (por capacidad) que cumple §3.3 para la carga.
 * Si ninguna alcanza, la más grande del catálogo (estimación conservadora).
 */
export function claseMasChicaElegible(carga: RequisitosDeCarga): ClaseVehiculoPorDefecto {
  for (const clase of CATALOGO) {
    const flota = [
      {
        id: clase.tipoVehiculo,
        unitCategory: 'motriz' as const,
        unitType: clase.unitType,
        bodyType: clase.bodyType,
        capacityKg: clase.capacityKg,
        capacityM3: null,
      },
    ];
    if (configuracionesElegibles(carga, flota).length > 0) {
      return clase.tipoVehiculo;
    }
  }
  const ultima = CATALOGO[CATALOGO.length - 1];
  if (!ultima) {
    throw new Error('catálogo de clases por defecto vacío');
  }
  return ultima.tipoVehiculo;
}

/** Entre varias cargas, la clase de mayor capacidad entre las elegidas por cada una. */
export function claseMasChicaQueCubre(
  cargas: readonly RequisitosDeCarga[],
): ClaseVehiculoPorDefecto {
  if (cargas.length === 0) {
    return 'camioneta';
  }
  let mejor: ClaseCatalogo | undefined;
  for (const carga of cargas) {
    const tipo = claseMasChicaElegible(carga);
    const clase = CATALOGO.find((c) => c.tipoVehiculo === tipo);
    if (!clase) {
      continue;
    }
    if (!mejor || clase.capacityKg > mejor.capacityKg) {
      mejor = clase;
    }
  }
  return mejor?.tipoVehiculo ?? 'camioneta';
}
