import { calcularExactoCanbus } from '../modos/exacto-canbus.js';
import { calcularModelado } from '../modos/modelado.js';
import { calcularPorDefecto } from '../modos/por-defecto.js';
import type {
  FactorEmisionCombustible,
  MetodoPrecision,
  ParametrosPorDefecto,
  PerfilVehiculo,
  ResultadoEmisiones,
} from '../tipos.js';

/**
 * Emisión de una ruta (ADR-089, spec huella-consolidada §3.1).
 *
 * La ruta es una secuencia de tramos; un tramo es el trayecto entre dos
 * paradas consecutivas, con la masa total a bordo en ese trayecto. Un tramo
 * vacío (posicionamiento, regreso, o entre una entrega y la recogida
 * siguiente) va con `cargaKg: 0` y también emite.
 *
 * - Con combustible medido, la emisión sale del combustible consumido en toda
 *   la ruta. No hay desglose por tramo: el CAN entrega el total.
 * - Sin él, cada tramo se modela con su distancia y su masa a bordo, con los
 *   mismos modos y factores que el cálculo por viaje, y se suman.
 *
 * Una ruta de un solo tramo da exactamente lo que da `calcularEmisionesViaje`
 * para ese viaje.
 *
 * El retorno vacío por factor (GLEC §6.4, `calcularEmptyBackhaul`) no entra
 * aquí: lo aplica quien orquesta, sobre el total de la ruta, cuando no hay
 * telemetría que mida el regreso (spec §3.2).
 */

export interface TramoDeRuta {
  readonly distanciaKm: number;
  /** Masa total a bordo en el tramo. 0 = tramo vacío. */
  readonly cargaKg: number;
}

export type ParametrosRuta =
  | {
      readonly metodo: 'exacto_canbus';
      readonly tramos: readonly TramoDeRuta[];
      /** Combustible consumido entre la primera y la última parada de la ruta. */
      readonly combustibleConsumido: number;
      readonly vehiculo: PerfilVehiculo;
    }
  | {
      readonly metodo: 'modelado';
      readonly tramos: readonly TramoDeRuta[];
      readonly vehiculo: PerfilVehiculo;
    }
  | {
      readonly metodo: 'por_defecto';
      readonly tramos: readonly TramoDeRuta[];
      readonly tipoVehiculo: ParametrosPorDefecto['tipoVehiculo'];
    };

export interface ResultadoEmisionesRuta {
  /** Total Well-to-Wheel de la ruta en kg CO₂e. */
  readonly emisionesKgco2eWtw: number;
  readonly emisionesKgco2eTtw: number;
  readonly emisionesKgco2eWtt: number;
  readonly combustibleConsumido: number;
  readonly unidadCombustible: FactorEmisionCombustible['unidad'];
  /** Distancia de toda la ruta, tramos vacíos incluidos. */
  readonly distanciaKm: number;
  /** Actividad de transporte: Σ toneladas a bordo × km de cada tramo. */
  readonly actividadTkm: number;
  /** g CO₂e por tonelada-kilómetro de la ruta. 0 si la ruta no movió carga. */
  readonly intensidadGco2ePorTonKm: number;
  readonly metodoPrecision: MetodoPrecision;
  readonly factorEmisionUsado: number;
  readonly versionGlec: string;
  readonly fuenteFactores: string;
  /** Resultado de cada tramo. `null` con combustible medido. */
  readonly tramos: readonly ResultadoEmisiones[] | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

function validarTramos(tramos: readonly TramoDeRuta[]): void {
  if (tramos.length === 0) {
    throw new Error('una ruta necesita al menos un tramo');
  }
  for (const [i, t] of tramos.entries()) {
    if (!Number.isFinite(t.distanciaKm) || t.distanciaKm < 0) {
      throw new Error(`tramo ${i}: distanciaKm debe ser un número finito >= 0`);
    }
    if (!Number.isFinite(t.cargaKg) || t.cargaKg < 0) {
      throw new Error(`tramo ${i}: cargaKg debe ser un número finito >= 0`);
    }
  }
}

const actividadDe = (tramos: readonly TramoDeRuta[]) =>
  tramos.reduce((suma, t) => suma + (t.cargaKg / 1000) * t.distanciaKm, 0);

const intensidadDe = (emisionesKg: number, actividadTkm: number) =>
  actividadTkm > 0 ? round2((emisionesKg * 1000) / actividadTkm) : 0;

function calcularTramo(
  params: Exclude<ParametrosRuta, { metodo: 'exacto_canbus' }>,
  tramo: TramoDeRuta,
): ResultadoEmisiones {
  return params.metodo === 'modelado'
    ? calcularModelado({ metodo: 'modelado', ...tramo, vehiculo: params.vehiculo })
    : calcularPorDefecto({ metodo: 'por_defecto', ...tramo, tipoVehiculo: params.tipoVehiculo });
}

/** Lo que la ruta publica igual que un viaje, tomado del resultado de un cálculo. */
function comunes(r: ResultadoEmisiones) {
  return {
    unidadCombustible: r.unidadCombustible,
    metodoPrecision: r.metodoPrecision,
    factorEmisionUsado: r.factorEmisionUsado,
    versionGlec: r.versionGlec,
    fuenteFactores: r.fuenteFactores,
  };
}

function conCombustibleMedido(
  params: Extract<ParametrosRuta, { metodo: 'exacto_canbus' }>,
): ResultadoEmisionesRuta {
  const { tramos, combustibleConsumido, vehiculo } = params;
  const actividad = actividadDe(tramos);
  const [unico] = tramos;
  const unSoloTramo = tramos.length === 1 && unico !== undefined;
  const medido = calcularExactoCanbus({
    metodo: 'exacto_canbus',
    distanciaKm: tramos.reduce((suma, t) => suma + t.distanciaKm, 0),
    combustibleConsumido,
    // La carga solo interviene en la intensidad; con varios tramos se calcula abajo.
    cargaKg: unSoloTramo ? unico.cargaKg : 0,
    vehiculo,
  });
  return {
    emisionesKgco2eWtw: medido.emisionesKgco2eWtw,
    emisionesKgco2eTtw: medido.emisionesKgco2eTtw,
    emisionesKgco2eWtt: medido.emisionesKgco2eWtt,
    combustibleConsumido: medido.combustibleConsumido,
    distanciaKm: medido.distanciaKm,
    actividadTkm: round3(actividad),
    intensidadGco2ePorTonKm: unSoloTramo
      ? medido.intensidadGco2ePorTonKm
      : intensidadDe(medido.emisionesKgco2eWtw, actividad),
    ...comunes(medido),
    tramos: null,
  };
}

export function calcularEmisionesRuta(params: ParametrosRuta): ResultadoEmisionesRuta {
  validarTramos(params.tramos);
  if (params.metodo === 'exacto_canbus') {
    return conCombustibleMedido(params);
  }

  const resultados = params.tramos.map((tramo) => calcularTramo(params, tramo));
  const [primero] = resultados;
  if (primero === undefined) {
    throw new Error('una ruta necesita al menos un tramo');
  }
  const actividad = actividadDe(params.tramos);

  if (resultados.length === 1) {
    // Dos paradas: es el viaje de hoy, con sus mismas cifras publicadas.
    return {
      emisionesKgco2eWtw: primero.emisionesKgco2eWtw,
      emisionesKgco2eTtw: primero.emisionesKgco2eTtw,
      emisionesKgco2eWtt: primero.emisionesKgco2eWtt,
      combustibleConsumido: primero.combustibleConsumido,
      distanciaKm: primero.distanciaKm,
      actividadTkm: round3(actividad),
      intensidadGco2ePorTonKm: primero.intensidadGco2ePorTonKm,
      ...comunes(primero),
      tramos: resultados,
    };
  }

  // Varios tramos: se suman las cifras ya publicadas de cada uno, para que la
  // ruta sea exactamente la suma de su desglose.
  const suma = (campo: (r: ResultadoEmisiones) => number) =>
    resultados.reduce((total, r) => total + campo(r), 0);
  const emisionesWtw = round3(suma((r) => r.emisionesKgco2eWtw));
  return {
    emisionesKgco2eWtw: emisionesWtw,
    emisionesKgco2eTtw: round3(suma((r) => r.emisionesKgco2eTtw)),
    emisionesKgco2eWtt: round3(suma((r) => r.emisionesKgco2eWtt)),
    combustibleConsumido: round2(suma((r) => r.combustibleConsumido)),
    distanciaKm: round2(params.tramos.reduce((total, t) => total + t.distanciaKm, 0)),
    actividadTkm: round3(actividad),
    intensidadGco2ePorTonKm: intensidadDe(emisionesWtw, actividad),
    ...comunes(primero),
    tramos: resultados,
  };
}
