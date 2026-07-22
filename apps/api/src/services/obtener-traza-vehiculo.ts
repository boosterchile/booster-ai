import type { Logger } from '@booster-ai/logger';
import { AVL_ID_CAN, type MinimalIoEntry, interpretCanLvcan } from '@booster-ai/shared-schemas';
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { telemetryPoints } from '../db/schema.js';
import { haversineKm } from './calcular-cobertura-telemetria.js';

/**
 * Historial de traza de un vehículo (capa 2, reframe): dada una ventana de
 * tiempo, arma el recorrido real (downsampleado) + un resumen (distancia,
 * duración, y si hay CAN, litros consumidos y km del odómetro CAN).
 *
 * A diferencia de `calcularCobertura` (que devuelve solo un %), acá se
 * necesita la lista de puntos y el `io_data` para los contadores CAN. Reusa
 * `haversineKm` y el patrón de ventana (`vehiculo_id` + `timestamp_device`
 * BETWEEN, índice `idx_telemetria_vehiculo_ts`).
 *
 * La entidad es el VEHÍCULO, no una carga: el discovery mostró 0 cargas
 * entregadas con telemetría en prod, mientras que los vehículos con pings
 * (PLFL57 con CAN) no tienen cargas. Ver `.specs/vehiculo-traza-historial/`.
 */

/** Punto de traza con los contadores CAN acumulados ya extraídos. */
export interface TrazaPoint {
  /** Timestamp del ping en epoch ms. */
  tMs: number;
  lat: number;
  lng: number;
  /** AVL 83 acumulado, litros. `null` si el ping no trae CAN. */
  fuelConsumedL: number | null;
  /** AVL 87 acumulado, km. `null` si el ping no trae CAN. */
  totalMileageKm: number | null;
}

/** Resumen de la ventana. CAN `null` si hay < 2 puntos con contador. */
export interface TrazaResumen {
  distanciaKm: number;
  duracionMin: number;
  litrosConsumidos: number | null;
  kmCan: number | null;
}

export interface TrazaVehiculoResult {
  /** Traza downsampleada (≤ maxPuntos), orden temporal ascendente. */
  puntos: Array<{ tMs: number; lat: number; lng: number }>;
  /** Puntos crudos en la ventana antes del downsampling (transparencia). */
  puntosTotal: number;
  resumen: TrazaResumen;
}

// =============================================================================
// PUROS (sin I/O — testeables como `calcularCoberturaPura`)
// =============================================================================

interface LatLng {
  lat: number;
  lng: number;
}

/** Suma de distancias haversine entre puntos consecutivos, en km. */
export function distanciaTotalKm(points: ReadonlyArray<LatLng>): number {
  let km = 0;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    if (!prev || !curr) {
      continue;
    }
    km += haversineKm(prev.lat, prev.lng, curr.lat, curr.lng);
  }
  return km;
}

/**
 * Distancia perpendicular aproximada de `p` a la recta `a`–`b`, en un plano
 * equirectangular local (lng escalada por cos(lat) para no distorsionar en
 * latitudes medias). Unidad arbitraria: solo importa el orden relativo para
 * elegir el vértice más significativo.
 */
function perpDistanciaAprox(p: LatLng, a: LatLng, b: LatLng): number {
  const cosLat = Math.cos((a.lat * Math.PI) / 180);
  const px = p.lng * cosLat;
  const py = p.lat;
  const ax = a.lng * cosLat;
  const ay = a.lat;
  const bx = b.lng * cosLat;
  const by = b.lat;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) {
    return Math.hypot(px - ax, py - ay);
  }
  const cross = Math.abs((px - ax) * dy - (py - ay) * dx);
  return cross / Math.sqrt(len2);
}

interface SegmentoCandidato {
  start: number;
  end: number;
  /** Índice interior con mayor desviación (-1 si el segmento no tiene interior). */
  idx: number;
  dist: number;
}

/** Encuentra el punto interior de mayor desviación del segmento `[start,end]`. */
function mejorInterior(
  points: ReadonlyArray<LatLng>,
  start: number,
  end: number,
): { idx: number; dist: number } {
  const a = points[start];
  const b = points[end];
  if (!a || !b) {
    return { idx: -1, dist: -1 };
  }
  let idx = -1;
  let dist = -1;
  for (let i = start + 1; i < end; i++) {
    const pi = points[i];
    if (!pi) {
      continue;
    }
    const d = perpDistanciaAprox(pi, a, b);
    if (d > dist) {
      dist = d;
      idx = i;
    }
  }
  return { idx, dist };
}

/**
 * Downsampling Douglas-Peucker **por conteo**: reduce la traza a ≤ `maxPuntos`
 * conservando siempre los extremos y, en orden de importancia, los vértices de
 * mayor desviación (los que definen la forma). Función pura.
 *
 * A diferencia del DP clásico (por tolerancia ε), acá el criterio de corte es
 * el presupuesto de puntos: se van agregando los vértices más significativos
 * hasta llegar a `maxPuntos` (o hasta que no queden desviaciones > 0).
 */
export function downsampleTraza<T extends LatLng>(points: readonly T[], maxPuntos: number): T[] {
  const cap = Math.max(2, Math.floor(maxPuntos));
  const n = points.length;
  if (n <= cap || n <= 2) {
    return points.slice();
  }

  const keep = new Set<number>([0, n - 1]);
  const segmentos: SegmentoCandidato[] = [];
  const primero = mejorInterior(points, 0, n - 1);
  if (primero.idx >= 0) {
    segmentos.push({ start: 0, end: n - 1, ...primero });
  }

  while (keep.size < cap && segmentos.length > 0) {
    let mi = 0;
    for (let i = 1; i < segmentos.length; i++) {
      const si = segmentos[i];
      const sm = segmentos[mi];
      if (si && sm && si.dist > sm.dist) {
        mi = i;
      }
    }
    const seg = segmentos.splice(mi, 1)[0];
    if (!seg || seg.idx < 0 || seg.dist <= 0) {
      // Solo quedan segmentos colineales: no aportan forma, cortamos.
      break;
    }
    keep.add(seg.idx);
    for (const [start, end] of [
      [seg.start, seg.idx],
      [seg.idx, seg.end],
    ] as const) {
      const mejor = mejorInterior(points, start, end);
      if (mejor.idx >= 0) {
        segmentos.push({ start, end, ...mejor });
      }
    }
  }

  const idxs = Array.from(keep).sort((a, b) => a - b);
  const out: T[] = [];
  for (const i of idxs) {
    const p = points[i];
    if (p) {
      out.push(p);
    }
  }
  return out;
}

/** Δ entre el último y el primer valor de una lista; `null` si hay < 2. */
function deltaExtremos(vals: readonly number[]): number | null {
  if (vals.length < 2) {
    return null;
  }
  const primero = vals[0];
  const ultimo = vals[vals.length - 1];
  if (primero === undefined || ultimo === undefined) {
    return null;
  }
  return ultimo - primero;
}

/** Arma el resumen (distancia, duración, CAN por Δ). Función pura. */
export function construirResumen(points: readonly TrazaPoint[]): TrazaResumen {
  if (points.length === 0) {
    return { distanciaKm: 0, duracionMin: 0, litrosConsumidos: null, kmCan: null };
  }
  const primero = points[0];
  const ultimo = points[points.length - 1];
  const duracionMin = primero && ultimo ? (ultimo.tMs - primero.tMs) / 60_000 : 0;

  const fuels: number[] = [];
  const kms: number[] = [];
  for (const p of points) {
    if (p.fuelConsumedL !== null) {
      fuels.push(p.fuelConsumedL);
    }
    if (p.totalMileageKm !== null) {
      kms.push(p.totalMileageKm);
    }
  }

  return {
    distanciaKm: distanciaTotalKm(points),
    duracionMin,
    litrosConsumidos: deltaExtremos(fuels),
    kmCan: deltaExtremos(kms),
  };
}

// =============================================================================
// I/O
// =============================================================================

/** Boundary del jsonb `io_data` (mismo criterio que `extractCan`). */
const ioDataRecordSchema = z.record(z.string(), z.union([z.number(), z.string()]));

/** Extrae los contadores CAN acumulados (83, 87) de un `io_data`. */
export function extraerCanAcumulado(ioData: unknown): {
  fuelConsumedL: number | null;
  totalMileageKm: number | null;
} {
  const parsed = ioDataRecordSchema.safeParse(ioData);
  if (!parsed.success) {
    return { fuelConsumedL: null, totalMileageKm: null };
  }
  const entries: MinimalIoEntry[] = [];
  for (const id of [AVL_ID_CAN.CAN_FUEL_CONSUMED_L, AVL_ID_CAN.CAN_TOTAL_MILEAGE] as const) {
    const raw = parsed.data[String(id)];
    if (typeof raw === 'number') {
      entries.push({ id, value: raw, byteSize: 4 });
    }
  }
  const { telemetry } = interpretCanLvcan(entries);
  return {
    fuelConsumedL: telemetry.fuelConsumedL ?? null,
    totalMileageKm: telemetry.totalMileageKm ?? null,
  };
}

/**
 * Carga la traza del vehículo en la ventana `[desde, hasta]`, arma el resumen
 * y devuelve la traza downsampleada a `maxPuntos`. Sin puntos → traza vacía y
 * resumen en cero/null, sin error.
 */
export async function obtenerTrazaVehiculo(opts: {
  db: Db;
  logger: Logger;
  vehicleId: string;
  desde: Date;
  hasta: Date;
  maxPuntos: number;
}): Promise<TrazaVehiculoResult> {
  const { db, logger, vehicleId, desde, hasta, maxPuntos } = opts;

  const rows = await db
    .select({
      ts: telemetryPoints.timestampDevice,
      lat: telemetryPoints.latitude,
      lng: telemetryPoints.longitude,
      io: telemetryPoints.ioData,
    })
    .from(telemetryPoints)
    .where(
      and(
        eq(telemetryPoints.vehicleId, vehicleId),
        gte(telemetryPoints.timestampDevice, desde),
        lte(telemetryPoints.timestampDevice, hasta),
      ),
    )
    .orderBy(asc(telemetryPoints.timestampDevice));

  const puntos: TrazaPoint[] = [];
  for (const r of rows) {
    if (r.lat === null || r.lng === null) {
      continue;
    }
    const can = extraerCanAcumulado(r.io);
    puntos.push({
      tMs: r.ts.getTime(),
      lat: Number(r.lat),
      lng: Number(r.lng),
      fuelConsumedL: can.fuelConsumedL,
      totalMileageKm: can.totalMileageKm,
    });
  }

  const resumen = construirResumen(puntos);
  const down = downsampleTraza(puntos, maxPuntos);

  logger.info(
    {
      vehicleId,
      desde,
      hasta,
      puntosTotal: puntos.length,
      puntosDevueltos: down.length,
      distanciaKm: resumen.distanciaKm,
      conCan: resumen.litrosConsumidos !== null,
    },
    'traza de vehículo calculada',
  );

  return {
    puntos: down.map((p) => ({ tMs: p.tMs, lat: p.lat, lng: p.lng })),
    puntosTotal: puntos.length,
    resumen,
  };
}
