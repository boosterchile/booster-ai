import type { RequisitosDeCarga, TipoDeUnidad } from './configuraciones.js';
import { DEFAULTS_POR_TIPO_CAPACIDAD } from './defaults-clase.js';
import {
  CARROCERIAS,
  COMPATIBILIDAD_CARGA_CARROCERIA,
  type Carroceria,
  type TipoDeCarga,
} from './tabla.js';

/**
 * Catálogo de clases por defecto para estimar huella sin vehículo declarado
 * (matching-desde-la-carga §3.12). La carrocería no cambia la clase de
 * emisión: se elige por capacidad entre clases genéricas; `refrigerado` y
 * `tanque` solo cuando la carga exige esa especialidad en la tabla §3.4.
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

/** Clases cuya carrocería del catálogo no es especializada (capacidad pura). */
const CLASES_GENERICAS: ReadonlySet<ClaseVehiculoPorDefecto> = new Set([
  'camioneta',
  'furgon_pequeno',
  'furgon_mediano',
  'camion_pequeno',
  'camion_mediano',
  'camion_pesado',
]);

const FALLBACK: ClaseVehiculoPorDefecto = 'camion_pesado';

/**
 * Si la tabla §3.4 admite una sola carrocería y esa es la del refrigerado o
 * del tanque del catálogo, la carga exige esa clase especializada.
 */
function especialidadExigida(cargoType: TipoDeCarga): 'refrigerado' | 'tanque' | null {
  const fila = COMPATIBILIDAD_CARGA_CARROCERIA[cargoType];
  const aptas = CARROCERIAS.filter((c) => fila[c]);
  if (aptas.length === 1 && aptas[0] === 'refrigerado') {
    return 'refrigerado';
  }
  if (aptas.length === 1 && aptas[0] === 'cisterna') {
    return 'tanque';
  }
  return null;
}

function cabePorCapacidad(clase: ClaseCatalogo, carga: RequisitosDeCarga): boolean {
  const peso = carga.weightKg ?? 0;
  return clase.capacityKg >= peso;
}

function porCapacidad(
  candidatas: readonly ClaseCatalogo[],
  carga: RequisitosDeCarga,
): ClaseVehiculoPorDefecto | null {
  for (const clase of candidatas) {
    if (cabePorCapacidad(clase, carga)) {
      return clase.tipoVehiculo;
    }
  }
  return null;
}

/**
 * Clase de vehículo más chica (por capacidad) para estimar huella §3.12.
 * Genéricas por peso; especializada solo si la carga lo exige; si ninguna
 * alcanza → `camion_pesado` (no `tanque`).
 */
export function claseMasChicaElegible(carga: RequisitosDeCarga): ClaseVehiculoPorDefecto {
  const especialidad = especialidadExigida(carga.cargoType);
  if (especialidad) {
    const especializada = CATALOGO.find((c) => c.tipoVehiculo === especialidad);
    if (especializada && cabePorCapacidad(especializada, carga)) {
      return especialidad;
    }
    return FALLBACK;
  }

  const genericas = CATALOGO.filter((c) => CLASES_GENERICAS.has(c.tipoVehiculo));
  return porCapacidad(genericas, carga) ?? FALLBACK;
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
