import type { TipoDeUnidad } from './configuraciones.js';
import type { Carroceria } from './tabla.js';

/**
 * Capacidades y carrocería típicas del enum legacy `tipo_vehiculo`, alineadas
 * con `DEFAULTS_POR_TIPO` de carbon-calculator y con
 * `derivarUnidadDesdeTipoLegacy` (shared-schemas). Solo motrices que cargan:
 * sin tracto (capacidad 0) ni arrastres sueltos.
 *
 * Sirve a `claseMasChicaElegible` (§3.12) sin acoplar matching-algorithm a
 * carbon-calculator.
 */
export const DEFAULTS_POR_TIPO_CAPACIDAD = {
  camioneta: {
    capacityKg: 1000,
    unitType: 'camioneta' as TipoDeUnidad,
    bodyType: null as Carroceria | null,
  },
  furgon_pequeno: {
    capacityKg: 1500,
    unitType: 'furgon' as TipoDeUnidad,
    bodyType: 'furgon_cerrado' as Carroceria | null,
  },
  furgon_mediano: {
    capacityKg: 3500,
    unitType: 'furgon' as TipoDeUnidad,
    bodyType: 'furgon_cerrado' as Carroceria | null,
  },
  camion_pequeno: {
    capacityKg: 5000,
    unitType: 'camion_rigido' as TipoDeUnidad,
    bodyType: null as Carroceria | null,
  },
  camion_mediano: {
    capacityKg: 12000,
    unitType: 'camion_rigido' as TipoDeUnidad,
    bodyType: null as Carroceria | null,
  },
  camion_pesado: {
    capacityKg: 28000,
    unitType: 'camion_rigido' as TipoDeUnidad,
    bodyType: null as Carroceria | null,
  },
  refrigerado: {
    capacityKg: 15000,
    unitType: 'camion_rigido' as TipoDeUnidad,
    bodyType: 'refrigerado' as Carroceria | null,
  },
  tanque: {
    capacityKg: 30000,
    unitType: 'camion_rigido' as TipoDeUnidad,
    bodyType: 'cisterna' as Carroceria | null,
  },
} as const;
