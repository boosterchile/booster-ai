import {
  type RequisitosDeCarga,
  type UnidadDeFlota,
  configuracionesElegibles,
} from './configuraciones.js';

/**
 * Candidatas de un matching según la elegibilidad por carga, y su comparación
 * con las del matching vigente (spec matching-desde-la-carga parte 2: flag y
 * comparación en sombra).
 */

/** Una empresa candidata y el vehículo que se le sugiere en la oferta. */
export interface CandidataPorFlota {
  readonly empresaId: string;
  readonly vehicleId: string;
  readonly vehicleCapacityKg: number;
}

/** Candidata según la elegibilidad por carga, con el aviso de volumen de su configuración. */
export interface CandidataPorCarga extends CandidataPorFlota {
  readonly volumenInsuficiente: boolean;
}

export interface ComparacionDeCandidatas {
  readonly coinciden: boolean;
  /** Empresas que el matching vigente ofrece y la elegibilidad por carga no. */
  readonly soloVigente: string[];
  /** Empresas que la elegibilidad por carga ofrece y el matching vigente no. */
  readonly soloPorCarga: string[];
  /** Empresas candidatas en los dos, con distinto vehículo sugerido. */
  readonly vehiculoDistinto: string[];
  /**
   * Empresas candidatas por carga cuya configuración sugerida declara menos
   * volumen que la carga. No las descarta ni cuenta como diferencia.
   */
  readonly volumenInsuficiente: string[];
}

/**
 * Las empresas con alguna configuración elegible para la carga, en el orden
 * en que vienen las flotas. El vehículo sugerido es la unidad motriz de la
 * primera configuración elegible (sin aviso de volumen si la hay, y la de menor
 * capacidad útil), y la capacidad es la de esa configuración (spec §3.6).
 */
export function candidatasPorCarga(
  carga: RequisitosDeCarga,
  flotas: ReadonlyMap<string, readonly UnidadDeFlota[]>,
): CandidataPorCarga[] {
  const candidatas: CandidataPorCarga[] = [];
  for (const [empresaId, flota] of flotas) {
    const [menor] = configuracionesElegibles(carga, flota);
    if (menor) {
      candidatas.push({
        empresaId,
        vehicleId: menor.motrizId,
        vehicleCapacityKg: menor.capacidadUtilKg,
        volumenInsuficiente: menor.volumenInsuficiente,
      });
    }
  }
  return candidatas;
}

/** Diferencias entre las candidatas del matching vigente y las de la elegibilidad por carga. */
export function compararCandidatas(
  vigente: readonly CandidataPorFlota[],
  porCarga: readonly (CandidataPorFlota & { readonly volumenInsuficiente?: boolean })[],
): ComparacionDeCandidatas {
  const vehiculoVigente = new Map(vigente.map((c) => [c.empresaId, c.vehicleId]));
  const vehiculoPorCarga = new Map(porCarga.map((c) => [c.empresaId, c.vehicleId]));

  const soloVigente = [...vehiculoVigente.keys()].filter((e) => !vehiculoPorCarga.has(e)).sort();
  const soloPorCarga = [...vehiculoPorCarga.keys()].filter((e) => !vehiculoVigente.has(e)).sort();
  const vehiculoDistinto = [...vehiculoVigente]
    .filter(([e, v]) => vehiculoPorCarga.has(e) && vehiculoPorCarga.get(e) !== v)
    .map(([e]) => e)
    .sort();

  return {
    coinciden:
      soloVigente.length === 0 && soloPorCarga.length === 0 && vehiculoDistinto.length === 0,
    soloVigente,
    soloPorCarga,
    vehiculoDistinto,
    volumenInsuficiente: porCarga
      .filter((c) => c.volumenInsuficiente === true)
      .map((c) => c.empresaId)
      .sort(),
  };
}
