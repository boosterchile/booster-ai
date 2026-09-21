/**
 * Cola de posiciones del móvil del conductor (Slot 3, GPS resiliente).
 *
 * Dos piezas puras, sin React ni red:
 *
 *   - `decidirReporte`: throttle por tiempo Y distancia con latido. La
 *     cobertura de huella (`calcular-cobertura-telemetria.ts`,
 *     CONTINUITY_GAP_S = 60) solo cuenta un tramo como cubierto si entre pings
 *     consecutivos pasan menos de 60 s: por eso, aunque el camión no se mueva,
 *     cada `heartbeatMs` (25 s) se envía igual. Decide con `timestamp_device`,
 *     no con el reloj de pared, para que sea determinista y testeable.
 *   - `ColaPosiciones`: FIFO persistida en localStorage por asignación. Lo que
 *     no se pudo enviar (sin señal) queda con su `timestamp_device` original y
 *     se reenvía en orden; el servidor calcula cobertura con ese timestamp, así
 *     que un tramo sin señal NO queda como hueco. Un punto que el API rechaza
 *     para siempre (400/422, o `accuracy_m` fuera del tope) se descarta y el
 *     drenaje sigue: un ping grosero no puede congelar los válidos de detrás
 *     (BOO-KJHITL, `.specs/gps-cola-rechazo-no-bloquea/`).
 */
import {
  type DriverPositionInput,
  type DriverPositionResponse,
  normalizarAccuracyM,
  normalizarHeadingDeg,
  normalizarSpeedKmh,
} from './driver-position.js';

export type PuntoEnCola = DriverPositionInput;

export interface OpcionesThrottle {
  /** Mínimo entre envíos cuando el vehículo se mueve. */
  minIntervalMs: number;
  /** Mínimo desplazamiento para enviar antes del latido. */
  minDistanceM: number;
  /** Máximo sin enviar: pasado esto se envía aunque no se haya movido. */
  heartbeatMs: number;
}

export const THROTTLE_DEFAULT: OpcionesThrottle = {
  minIntervalMs: 10_000,
  minDistanceM: 10,
  heartbeatMs: 25_000,
};

const RADIO_TIERRA_M = 6_371_000;

export function distanciaHaversineM(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * RADIO_TIERRA_M * Math.asin(Math.sqrt(h));
}

export function decidirReporte(
  prev: PuntoEnCola | null,
  next: PuntoEnCola,
  opts: OpcionesThrottle,
): 'enviar' | 'omitir' {
  if (!prev) {
    return 'enviar';
  }
  const dtMs = Date.parse(next.timestamp_device) - Date.parse(prev.timestamp_device);
  if (dtMs >= opts.heartbeatMs) {
    return 'enviar';
  }
  if (dtMs < opts.minIntervalMs) {
    return 'omitir';
  }
  const d = distanciaHaversineM(
    { lat: prev.latitude, lng: prev.longitude },
    { lat: next.latitude, lng: next.longitude },
  );
  return d >= opts.minDistanceM ? 'enviar' : 'omitir';
}

/** Subconjunto de `Storage` que usamos; inyectable para tests. */
export interface AlmacenCola {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface OpcionesCola {
  /** `undefined` = localStorage del navegador si existe; `null` = solo memoria. */
  almacen?: AlmacenCola | null;
  /** Máximo de puntos retenidos; al superarlo se descarta el más viejo. */
  tope?: number;
}

export interface ResultadoDrenaje {
  enviados: number;
  restantes: number;
  /** Cabezas tiradas por no enviables o por 400/422 del API. */
  descartados: number;
  /** Por qué paró antes de vaciar: fallo transitorio (se reintenta después) o
   *  asignación cerrada (409, la cola se descarta). `null` = vació todo. */
  detenido: null | 'fallo' | 'asignacion_cerrada';
}

/** Tope de `accuracy_m` en POST /assignments/:id/driver-position (Zod `.max`). */
export const ACCURACY_M_MAX = 10_000;

export const COLA_TOPE_DEFAULT = 3000;

/** 409 `assignment_not_active`: la asignación ya no acepta posiciones. */
export function esAsignacionCerrada(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) {
    return false;
  }
  const e = err as { status?: unknown; code?: unknown };
  return e.status === 409 && e.code === 'assignment_not_active';
}

/** 400/422: el punto no va a pasar aunque reintentemos (validación Zod). */
export function esRechazoPermanente(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) {
    return false;
  }
  const e = err as { status?: unknown };
  return e.status === 400 || e.status === 422;
}

/**
 * Espejo del body Zod de `POST /assignments/:id/driver-position`.
 * `accuracy_m` 0 / NaN / null = desconocida (se manda null, el punto vale).
 * Un radio > 10 km hace las coords inútiles: se tira el punto entero.
 */
export function esPuntoEnviable(p: PuntoEnCola): boolean {
  if (!Number.isFinite(p.latitude) || p.latitude < -90 || p.latitude > 90) {
    return false;
  }
  if (!Number.isFinite(p.longitude) || p.longitude < -180 || p.longitude > 180) {
    return false;
  }
  if (!Number.isFinite(Date.parse(p.timestamp_device))) {
    return false;
  }
  const acc = normalizarAccuracyM(p.accuracy_m);
  return acc == null || acc <= ACCURACY_M_MAX;
}

function puntoParaEnviar(p: PuntoEnCola): PuntoEnCola {
  return {
    ...p,
    accuracy_m: normalizarAccuracyM(p.accuracy_m),
    // Un body ya encolado con speed/heading fuera de rango (cliente viejo o
    // WebView) no puede 400 el POST: se anulan y las coordenadas siguen.
    speed_kmh: normalizarSpeedKmh(p.speed_kmh),
    heading_deg: normalizarHeadingDeg(p.heading_deg),
  };
}

function almacenPorDefecto(): AlmacenCola | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
  } catch {
    // Safari privado / storage bloqueado: el accessor mismo lanza. Sin
    // persistencia la cola vive en memoria; no es un error del reporte.
    return null;
  }
}

function esPunto(x: unknown): x is PuntoEnCola {
  if (typeof x !== 'object' || x === null) {
    return false;
  }
  const p = x as Record<string, unknown>;
  return (
    typeof p.timestamp_device === 'string' &&
    typeof p.latitude === 'number' &&
    typeof p.longitude === 'number'
  );
}

export class ColaPosiciones {
  private items: PuntoEnCola[];
  private readonly key: string;
  private readonly almacen: AlmacenCola | null;
  private readonly tope: number;

  constructor(assignmentId: string, opts: OpcionesCola = {}) {
    this.key = `booster.posiciones.${assignmentId}`;
    this.almacen = opts.almacen === undefined ? almacenPorDefecto() : opts.almacen;
    this.tope = opts.tope ?? COLA_TOPE_DEFAULT;
    this.items = this.leer();
  }

  pendientes(): number {
    return this.items.length;
  }

  primero(): PuntoEnCola | null {
    return this.items[0] ?? null;
  }

  /** `false` si el punto no es enviable: no entra a la cola. */
  encolar(punto: PuntoEnCola): boolean {
    const normalizado = puntoParaEnviar(punto);
    if (!esPuntoEnviable(normalizado)) {
      return false;
    }
    this.items.push(normalizado);
    if (this.items.length > this.tope) {
      this.items.splice(0, this.items.length - this.tope);
    }
    this.persistir();
    return true;
  }

  vaciar(): void {
    this.items = [];
    this.persistir();
  }

  /** Envía en orden (el más viejo primero). Se detiene en el primer fallo
   *  transitorio y conserva el resto; 400/422 o punto no enviable tiran la
   *  cabeza y siguen; 409 asignación cerrada descarta todo. */
  async drenar(
    enviar: (punto: PuntoEnCola) => Promise<DriverPositionResponse>,
  ): Promise<ResultadoDrenaje> {
    let enviados = 0;
    let descartados = 0;
    while (this.items.length > 0) {
      const punto = this.items[0];
      if (!punto) {
        break;
      }
      const paraEnviar = puntoParaEnviar(punto);
      if (!esPuntoEnviable(paraEnviar)) {
        this.items.shift();
        descartados += 1;
        this.persistir();
        continue;
      }
      try {
        await enviar(paraEnviar);
      } catch (err) {
        if (esAsignacionCerrada(err)) {
          this.vaciar();
          return { enviados, restantes: 0, descartados, detenido: 'asignacion_cerrada' };
        }
        if (esRechazoPermanente(err)) {
          this.items.shift();
          descartados += 1;
          this.persistir();
          continue;
        }
        this.persistir();
        return { enviados, restantes: this.items.length, descartados, detenido: 'fallo' };
      }
      this.items.shift();
      enviados += 1;
    }
    this.persistir();
    return { enviados, restantes: 0, descartados, detenido: null };
  }

  private leer(): PuntoEnCola[] {
    if (!this.almacen) {
      return [];
    }
    try {
      const raw = this.almacen.getItem(this.key);
      if (!raw) {
        return [];
      }
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(esPunto) : [];
    } catch {
      // Storage ilegible o corrupto: se parte de cero, no se bloquea el reporte.
      return [];
    }
  }

  private persistir(): void {
    if (!this.almacen) {
      return;
    }
    try {
      if (this.items.length === 0) {
        this.almacen.removeItem(this.key);
      } else {
        this.almacen.setItem(this.key, JSON.stringify(this.items));
      }
    } catch {
      // Cuota llena o storage bloqueado: la cola sigue en memoria mientras la
      // app esté abierta. Se pierde solo la persistencia entre recargas.
    }
  }
}
