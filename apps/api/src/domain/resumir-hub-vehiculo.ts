import {
  type RazonKmPorLitroNoConfiable,
  type TrayectoTeltonika,
  notaKmPorLitroNoConfiable,
  razonExclusionKmPorLitro,
} from './segmentar-trayectos-teltonika.js';

/** Cuántos trayectos muestra el hub. El conteo de alertas mira la ventana completa. */
export const RECIENTES_HUB = 10;

export interface ResumenHubVehiculo {
  ultimo: TrayectoTeltonika | null;
  recientes: TrayectoTeltonika[];
  /** Suma de km de `recientes`. No incluye el resto de la ventana. */
  kmRecientes: number;
  /** Suma de litros ya calculados en `recientes`. Null si ninguno trae litros. */
  litrosRecientes: number | null;
  /**
   * Σ kmCubiertos / ΣL de los trayectos de la ventana que sí entran.
   * No es el km/L de un trayecto ni el promedio de esos cocientes.
   * No suma `distanciaKm`. Null si no hay litros que entren.
   * Cobertura bajo 80 %, `sin_sensor` y un trayecto sobre 6,25 km/L no entran.
   * Los que entran ya están en el tope o debajo, así que la suma tampoco lo pasa.
   */
  kmPorLitro: number | null;
  /**
   * Por qué el KPI quedó en null. «dato no confiable» si solo quedaron trayectos
   * `sobre_tope`. Con razón («cobertura baja» / «sin sensor de combustible») si
   * eso vació la suma. Null si hay un km/L o si la ventana no tenía litros que excluir.
   */
  motivoKmPorLitro: string | null;
  /** True si hay trayectos y todos piden conectar el sensor. */
  ctaSensor: boolean;
  /** Algún trayecto tiene porcentaje del 84 y le falta la capacidad. */
  ctaCapacidadEstanque: boolean;
  /** Trayectos con badge de golpe u hormiga en toda la ventana, no solo `recientes`. */
  alertasTotal: number;
  alertaUltima: TrayectoTeltonika | null;
}

function porFinDesc(a: TrayectoTeltonika, b: TrayectoTeltonika): number {
  const fin = Date.parse(b.fin) - Date.parse(a.fin);
  if (fin !== 0) {
    return fin;
  }
  return Date.parse(b.inicio) - Date.parse(a.inicio);
}

function tieneAlerta(trayecto: TrayectoTeltonika): boolean {
  return trayecto.posibleRoboCombustible || trayecto.posibleRoboHormiga;
}

function kmPorLitroDeVentana(trayectos: readonly TrayectoTeltonika[]): {
  kmPorLitro: number | null;
  motivoKmPorLitro: string | null;
} {
  const razones = new Set<RazonKmPorLitroNoConfiable>();
  const conLitros: TrayectoTeltonika[] = [];
  for (const trayecto of trayectos) {
    const razon = razonExclusionKmPorLitro(trayecto);
    if (razon) {
      razones.add(razon);
      continue;
    }
    if (
      trayecto.litrosConsumidos != null &&
      trayecto.litrosConsumidos > 0 &&
      trayecto.kmCubiertos != null
    ) {
      conLitros.push(trayecto);
    }
  }
  const litros = conLitros.reduce((suma, t) => suma + (t.litrosConsumidos ?? 0), 0);
  if (!(litros > 0)) {
    return {
      kmPorLitro: null,
      motivoKmPorLitro: razones.size > 0 ? notaKmPorLitroNoConfiable([...razones]) : null,
    };
  }
  const km = conLitros.reduce((suma, t) => suma + (t.kmCubiertos ?? 0), 0);
  const kmPorLitro = Math.round((km / litros + Number.EPSILON) * 100) / 100;
  return { kmPorLitro, motivoKmPorLitro: null };
}

/**
 * Arma el resumen del hub a partir de trayectos ya segmentados.
 * No detecta robos ni recalcula litros. El km/L de la ventana es Σ kmCubiertos / ΣL.
 */
export function resumirHubVehiculo(trayectos: readonly TrayectoTeltonika[]): ResumenHubVehiculo {
  const ordenados = [...trayectos].sort(porFinDesc);
  const recientes = ordenados.slice(0, RECIENTES_HUB);
  const ultimo = ordenados[0] ?? null;
  const kmRecientes = recientes.reduce((suma, t) => suma + t.distanciaKm, 0);
  const conLitros = recientes.filter((t) => t.litrosConsumidos != null);
  const litrosRecientes =
    conLitros.length > 0
      ? conLitros.reduce((suma, t) => suma + (t.litrosConsumidos ?? 0), 0)
      : null;
  const { kmPorLitro, motivoKmPorLitro } = kmPorLitroDeVentana(ordenados);
  const conAlerta = ordenados.filter(tieneAlerta);
  return {
    ultimo,
    recientes,
    kmRecientes,
    litrosRecientes,
    kmPorLitro,
    motivoKmPorLitro,
    ctaSensor: ordenados.length > 0 && ordenados.every((t) => t.ctaSensor),
    ctaCapacidadEstanque: ordenados.some((t) => t.ctaCapacidadEstanque),
    alertasTotal: conAlerta.length,
    alertaUltima: conAlerta[0] ?? null,
  };
}
