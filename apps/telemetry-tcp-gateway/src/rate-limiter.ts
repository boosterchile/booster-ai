/**
 * Rate limiting in-memory (per-pod) para el TCP gateway (audit P1-L).
 *
 * El gateway expone puertos TCP a la red para los devices Teltonika y hace
 * "open enrollment" de IMEIs desconocidos. Sin límites, un atacante en la red
 * puede agotar FDs/memoria (muchas conexiones) o inflar `dispositivos_pendientes`
 * (muchos IMEIs nuevos). Estas dos primitivas son la barrera:
 *
 *   - ConnectionGuard: cap de conexiones concurrentes (gauge) → FDs/memoria.
 *   - SlidingWindowLimiter: cap de eventos por ventana → enrollment.
 *
 * In-memory y per-pod a propósito: el gateway no tiene Redis, y el control
 * relevante para DoS es local al proceso (cada pod protege sus propios FDs).
 * No depende de la IP cliente (el LB TCP puede enmascararla).
 */

/** Cap de conexiones concurrentes. `tryAcquire` toma un slot; `release` lo devuelve. */
export interface ConnectionGuard {
  /** Toma un slot. `false` si ya se alcanzó el máximo (rechazar la conexión). */
  tryAcquire(): boolean;
  /** Devuelve un slot al cerrarse la conexión. Idempotente bajo el piso 0. */
  release(): void;
  /** Conexiones activas actuales. */
  readonly active: number;
}

export function createConnectionGuard(maxConcurrent: number): ConnectionGuard {
  let active = 0;
  return {
    tryAcquire(): boolean {
      if (active >= maxConcurrent) {
        return false;
      }
      active += 1;
      return true;
    },
    release(): void {
      if (active > 0) {
        active -= 1;
      }
    },
    get active(): number {
      return active;
    },
  };
}

/** Limita eventos a `maxEvents` dentro de una ventana deslizante de `windowMs`. */
export interface RateLimiter {
  /** Registra un evento y retorna `true` si está dentro del límite, `false` si lo excede. */
  tryConsume(): boolean;
}

export function createSlidingWindowLimiter(opts: {
  maxEvents: number;
  windowMs: number;
  /** Inyectable para tests; default `Date.now`. */
  now?: () => number;
}): RateLimiter {
  const { maxEvents, windowMs } = opts;
  const now = opts.now ?? Date.now;
  let timestamps: number[] = [];

  return {
    tryConsume(): boolean {
      const cutoff = now() - windowMs;
      // Poda los eventos que ya salieron de la ventana (estrictamente viejos).
      timestamps = timestamps.filter((ts) => ts > cutoff);
      if (timestamps.length >= maxEvents) {
        return false;
      }
      timestamps.push(now());
      return true;
    },
  };
}
