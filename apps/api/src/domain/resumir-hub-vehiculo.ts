import type { TrayectoTeltonika } from './segmentar-trayectos-teltonika.js';

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
   * km/L del trayecto más reciente que ya lo trae. Null si ninguno lo trae:
   * no se divide km/L a mano (el segmentador lo omite bajo 5 L o 10 km).
   */
  kmPorLitro: number | null;
  /** True si hay trayectos y todos piden conectar el sensor. */
  ctaSensor: boolean;
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

/**
 * Arma el resumen del hub a partir de trayectos ya segmentados.
 * No detecta robos ni recalcula combustible: solo ordena y suma.
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
  const kmPorLitro = ordenados.find((t) => t.kmPorLitro != null)?.kmPorLitro ?? null;
  const conAlerta = ordenados.filter(tieneAlerta);
  return {
    ultimo,
    recientes,
    kmRecientes,
    litrosRecientes,
    kmPorLitro,
    ctaSensor: ordenados.length > 0 && ordenados.every((t) => t.ctaSensor),
    alertasTotal: conAlerta.length,
    alertaUltima: conAlerta[0] ?? null,
  };
}
