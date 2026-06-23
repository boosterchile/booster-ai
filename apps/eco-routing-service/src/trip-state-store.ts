/**
 * TripStateStore — estado per-viaje para el eco-routing-service.
 *
 * Decisión Redis vs. in-memory:
 * ─────────────────────────────
 * Se eligió **in-memory con TTL** por las siguientes razones:
 *
 * 1. El eco-routing-service es stateless excepto por el cooldown y la
 *    posición en vivo. Si el servicio reinicia, el peor caso es que se
 *    recalcula el baseline ETA en el primer evento (best-effort por diseño
 *    — spec §7: "nunca bloquea el viaje").
 *
 * 2. Los viajes activos son pocos (<100 en piloto) y el estado por viaje
 *    es mínimo (<1 KB). La presión de memoria es insignificante.
 *
 * 3. Redis añadiría latencia de red por lookup en el hot path de cada
 *    mensaje Pub/Sub (decenas/segundo). In-memory es O(1) constante.
 *
 * 4. El proyecto ya tiene Redis (ADR-058, Memorystore) pero las
 *    complicaciones de TLS CA pinning documentadas en la memoria
 *    (redis-tls-ca-pinning-2026-06.md) hacen que sea mejor evitar
 *    acoplamiento innecesario en este servicio para el MVP.
 *
 * Mitigación de la pérdida de estado en reinicios:
 * - TTL de 4h (configurable) cubre los viajes más largos.
 * - Si el servicio tiene >1 instancia (Cloud Run scale-out), cada
 *   instancia tiene su propio store — los mensajes Pub/Sub para un
 *   mismo viaje pueden llegar a instancias distintas, lo que puede
 *   causar cooldown inconsistente. Aceptado como best-effort para el
 *   piloto (escala pequeña). Si en producción se necesita consistencia
 *   cross-instancia, migrar a Redis (ADR required).
 */

/** Posición normalizada en el store (subset de DriverPositionEvent). */
export interface PosicionStored {
  lat: number;
  lng: number;
  registradoEn: string; // ISO 8601
}

/** Estado completo de un viaje en el store. */
export interface TripEstado {
  posicionActual: PosicionStored;
  /** ETA en segundos calculado al inicio del viaje. Null hasta que se compute. */
  etaBaselineSegundos: number | null;
  /** Timestamp de la última sugerencia enviada. Null si no hubo sugerencias. */
  ultimaSugerenciaEn: Date | null;
  /** Timestamp de la última actualización (para TTL). */
  actualizadoEn: Date;
}

/**
 * Interfaz pública del store — injectable y testeable.
 * Task 6 la consume para la lógica de evaluación.
 */
export interface TripStateStore {
  /**
   * Retorna el estado del viaje, o null si no existe o ha expirado (TTL).
   */
  getEstado(viajeId: string): TripEstado | null;

  /**
   * Actualiza (o inicializa) la posición actual del viaje.
   * Renueva el TTL.
   */
  setPosicion(viajeId: string, posicion: PosicionStored): void;

  /**
   * Persiste el ETA baseline (en segundos) para el viaje.
   * Inicializa el estado si no existía.
   * Renueva el TTL.
   */
  setBaseline(viajeId: string, etaBaselineSegundos: number): void;

  /**
   * Marca que se emitió una sugerencia ahora.
   * Usado para el gate de cooldown.
   */
  registrarSugerencia(viajeId: string): void;

  /**
   * Retorna true si el viaje puede recibir una nueva sugerencia
   * (no hay sugerencia dentro del cooldown, o nunca hubo).
   *
   * @param viajeId - ID del viaje
   * @param cooldownSegundos - Ventana de cooldown en segundos
   */
  puedeSugerir(viajeId: string, cooldownSegundos: number): boolean;
}

interface InMemoryEntry {
  estado: TripEstado;
  expiresAt: number; // Date.now() ms
}

export interface InMemoryTripStateStoreOptions {
  /** Tiempo de vida del estado por viaje en ms. Default: 4h. */
  ttlMs: number;
}

/**
 * Crea una instancia in-memory del TripStateStore con TTL por entrada.
 *
 * El TTL se verifica de forma lazy (en cada acceso), sin timers de
 * background. Esto evita memory leaks si hay muchos viajes y simplifica
 * el lifecycle del store.
 */
export function createInMemoryTripStateStore(opts: InMemoryTripStateStoreOptions): TripStateStore {
  const { ttlMs } = opts;
  const map = new Map<string, InMemoryEntry>();

  function getEntry(viajeId: string): InMemoryEntry | null {
    const entry = map.get(viajeId);
    if (!entry) {
      return null;
    }
    // Lazy TTL check
    if (Date.now() > entry.expiresAt) {
      map.delete(viajeId);
      return null;
    }
    return entry;
  }

  function upsertEstado(viajeId: string, updater: (prev: TripEstado | null) => TripEstado): void {
    const existing = getEntry(viajeId);
    const prev = existing?.estado ?? null;
    const next = updater(prev);
    map.set(viajeId, {
      estado: next,
      expiresAt: Date.now() + ttlMs,
    });
  }

  return {
    getEstado(viajeId) {
      return getEntry(viajeId)?.estado ?? null;
    },

    setPosicion(viajeId, posicion) {
      upsertEstado(viajeId, (prev) => ({
        posicionActual: posicion,
        etaBaselineSegundos: prev?.etaBaselineSegundos ?? null,
        ultimaSugerenciaEn: prev?.ultimaSugerenciaEn ?? null,
        actualizadoEn: new Date(),
      }));
    },

    setBaseline(viajeId, etaBaselineSegundos) {
      upsertEstado(viajeId, (prev) => ({
        posicionActual: prev?.posicionActual ?? {
          lat: 0,
          lng: 0,
          registradoEn: new Date().toISOString(),
        },
        etaBaselineSegundos,
        ultimaSugerenciaEn: prev?.ultimaSugerenciaEn ?? null,
        actualizadoEn: new Date(),
      }));
    },

    registrarSugerencia(viajeId) {
      upsertEstado(viajeId, (prev) => ({
        posicionActual: prev?.posicionActual ?? {
          lat: 0,
          lng: 0,
          registradoEn: new Date().toISOString(),
        },
        etaBaselineSegundos: prev?.etaBaselineSegundos ?? null,
        ultimaSugerenciaEn: new Date(),
        actualizadoEn: new Date(),
      }));
    },

    puedeSugerir(viajeId, cooldownSegundos) {
      // Sin cooldown configurado → siempre puede sugerir
      if (cooldownSegundos <= 0) {
        return true;
      }
      const estado = this.getEstado(viajeId);
      if (!estado || !estado.ultimaSugerenciaEn) {
        return true;
      }
      const elapsedMs = Date.now() - estado.ultimaSugerenciaEn.getTime();
      // El cooldown es EXCLUSIVO en el límite: el conductor puede sugerir
      // solo cuando han pasado ESTRICTAMENTE más de cooldownSegundos.
      // Ej: cooldown=300s → a los 300s exactos aún NO puede; a los 300s+1ms sí.
      return elapsedMs > cooldownSegundos * 1000;
    },
  };
}
