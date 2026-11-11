import { derivarNivelCertificacion } from '../certificacion/derivar-nivel.js';
import type { MetodoPrecision, NivelCertificacion, RouteDataSource } from '../tipos.js';

/**
 * Nivel de certificación de una ruta (ADR-089, spec huella-consolidada §3.8;
 * matriz de ADR-028 y ADR-077).
 *
 * Se deriva una vez por ruta y todos sus servicios lo heredan. La ruta se
 * mide por tramos, y dos decisiones resumen esos tramos:
 *
 * - **Cobertura**: la de los tramos, ponderada por su distancia.
 * - **Fuente**: la más débil entre los tramos. Una ruta con un tramo medido
 *   con el celular, o declarado a mano, no se certifica como si toda ella
 *   viniera del GPS del vehículo.
 *
 * Con un solo tramo el resultado es el de `derivarNivelCertificacion`.
 */

export interface TramoMedido {
  readonly distanciaKm: number;
  readonly routeDataSource: RouteDataSource;
  /** Fracción del tramo cubierta por su fuente, en [0, 100]. */
  readonly coveragePct: number;
}

export interface NivelDeRuta {
  readonly nivel: NivelCertificacion;
  /** La fuente con la que se derivó el nivel: la más débil de los tramos. */
  readonly routeDataSource: RouteDataSource;
  /** La cobertura con la que se derivó el nivel. */
  readonly coveragePct: number;
}

/** De la fuente más débil a la más fuerte. */
const FUERZA: Readonly<Record<RouteDataSource, number>> = {
  manual_declared: 0,
  maps_directions: 1,
  movil_gps: 2,
  teltonika_gps: 3,
};

export function derivarNivelRuta(input: {
  readonly precisionMethod: MetodoPrecision;
  readonly tramos: readonly TramoMedido[];
}): NivelDeRuta {
  const { precisionMethod, tramos } = input;
  const [primero] = tramos;
  if (primero === undefined) {
    throw new Error('una ruta necesita al menos un tramo para derivar su nivel');
  }
  for (const [i, t] of tramos.entries()) {
    if (!Number.isFinite(t.distanciaKm) || t.distanciaKm < 0) {
      throw new Error(`tramo ${i}: distanciaKm debe ser un número finito >= 0`);
    }
    if (!(t.coveragePct >= 0 && t.coveragePct <= 100)) {
      throw new Error(`tramo ${i}: coveragePct debe estar en [0, 100], recibido ${t.coveragePct}`);
    }
  }

  const routeDataSource = tramos.reduce(
    (debil, t) => (FUERZA[t.routeDataSource] < FUERZA[debil] ? t.routeDataSource : debil),
    primero.routeDataSource,
  );

  let coveragePct = primero.coveragePct;
  if (tramos.length > 1) {
    const distancia = tramos.reduce((suma, t) => suma + t.distanciaKm, 0);
    coveragePct =
      distancia > 0
        ? tramos.reduce((suma, t) => suma + t.distanciaKm * t.coveragePct, 0) / distancia
        : 0;
  }

  return {
    nivel: derivarNivelCertificacion({ precisionMethod, routeDataSource, coveragePct }),
    routeDataSource,
    coveragePct,
  };
}
