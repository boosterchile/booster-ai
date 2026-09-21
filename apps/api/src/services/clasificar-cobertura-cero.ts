import { count, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { posicionesMovilConductor } from '../db/schema.js';
import { CONTINUITY_GAP_S, haversineKm } from './calcular-cobertura-telemetria.js';
import {
  type FuentePosicionSegmento,
  type PingPoint,
  type VehiculoFuentePosicion,
  fuentePosicionSegmento,
  resolverPosicionesSegmento,
} from './posicion-segmento.js';

/**
 * Por qué un viaje cerró con `cobertura_pct = 0` aunque el teléfono haya
 * hecho POST (BOO-83ND2C).
 *
 * `pointsSent` cuenta filas aceptadas. `cobertura_pct` es otra cosa: fracción
 * de distancia con hueco < 60 s (ADR-028 §5). Si esa suma es 0, el cierre
 * persiste 0. Este módulo no cambia ese número — dice cuál de las reglas lo
 * produjo, para no pintar «0 %» como si no hubiera llegado ningún punto.
 *
 * La fuente es la de la huella (ADR-077), no la del tracking en vivo: con
 * dispositivo, los puntos del teléfono no entran aunque el vivo los muestre.
 */
export const MOTIVOS_COBERTURA_CERO = [
  'sin_puntos',
  'fuera_de_tramo',
  'sin_tramo_continuo',
  'sin_desplazamiento',
  'sin_telemetria_dispositivo',
  'medicion_no_cerrada',
] as const;

export type MotivoCoberturaCero = (typeof MOTIVOS_COBERTURA_CERO)[number];

export interface ClasificacionCoberturaCero {
  /** `null` si la cobertura persistida ya es > 0: no hay un cero que explicar. */
  motivo: MotivoCoberturaCero | null;
  /** Pings de la fuente del vehículo dentro de la ventana del tramo. */
  puntosEnTramo: number;
}

export function clasificarCoberturaCero(input: {
  /** Cobertura ya persistida, en [0, 100]. */
  coveragePct: number;
  fuente: FuentePosicionSegmento;
  /** Misma lista que usó el cierre: ventana real, fix válido, una sola fuente. */
  pingsEnTramo: readonly PingPoint[];
  /** Filas de `posiciones_movil_conductor` de esta asignación, con o sin ventana. */
  puntosTelefono: number;
}): ClasificacionCoberturaCero {
  const puntosEnTramo = input.pingsEnTramo.length;
  if (input.coveragePct > 0) {
    return { motivo: null, puntosEnTramo };
  }

  if (puntosEnTramo === 0) {
    if (input.puntosTelefono > 0) {
      return {
        motivo: input.fuente === 'teltonika_gps' ? 'sin_telemetria_dispositivo' : 'fuera_de_tramo',
        puntosEnTramo,
      };
    }
    return { motivo: 'sin_puntos', puntosEnTramo };
  }

  let hayContinuo = false;
  let km = 0;
  for (let i = 1; i < input.pingsEnTramo.length; i++) {
    const prev = input.pingsEnTramo[i - 1];
    const curr = input.pingsEnTramo[i];
    if (!prev || !curr) {
      continue;
    }
    const gapS = (curr.tMs - prev.tMs) / 1000;
    if (gapS < CONTINUITY_GAP_S) {
      hayContinuo = true;
      km += haversineKm(prev.lat, prev.lng, curr.lat, curr.lng);
    }
  }

  if (!hayContinuo) {
    return { motivo: 'sin_tramo_continuo', puntosEnTramo };
  }
  if (km <= 0) {
    return { motivo: 'sin_desplazamiento', puntosEnTramo };
  }
  // Había km observados y aun así se guardó 0: abort de Routes o tope de huecos.
  return { motivo: 'medicion_no_cerrada', puntosEnTramo };
}

export interface CoberturaExplicada {
  motivo: MotivoCoberturaCero | null;
  fuente: FuentePosicionSegmento;
  puntos_telefono: number;
  puntos_en_tramo: number;
}

/**
 * Arma la explicación de un cierre con cobertura 0. No se llama si el
 * porcentaje persistido ya es > 0: no hay nada que desmentir.
 */
export async function explicarCoberturaCero(opts: {
  db: Db;
  assignmentId: string;
  vehicle: VehiculoFuentePosicion;
  desde: Date | null;
  hasta: Date | null;
  coveragePct: number;
}): Promise<CoberturaExplicada> {
  const fuente = fuentePosicionSegmento(opts.vehicle).fuente;
  // rls-allowlist: conteo del assignment que GET /resultado ya autorizó
  const [conteo] = await opts.db
    .select({ n: count() })
    .from(posicionesMovilConductor)
    .where(eq(posicionesMovilConductor.assignmentId, opts.assignmentId));
  const puntosTelefono = Number(conteo?.n ?? 0);
  const pings =
    opts.desde && opts.hasta
      ? await resolverPosicionesSegmento({
          db: opts.db,
          vehicle: opts.vehicle,
          desde: opts.desde,
          hasta: opts.hasta,
        })
      : [];
  const clasificacion = clasificarCoberturaCero({
    coveragePct: opts.coveragePct,
    fuente,
    pingsEnTramo: pings,
    puntosTelefono,
  });
  return {
    motivo: clasificacion.motivo,
    fuente,
    puntos_telefono: puntosTelefono,
    puntos_en_tramo: clasificacion.puntosEnTramo,
  };
}
