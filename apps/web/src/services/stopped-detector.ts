/**
 * Detector de "vehículo parado" basado en Geolocation API (Phase 4 PR-K1).
 *
 * **Por qué este detector existe**:
 *   El playbook 002 (canal coaching = voz) define que el auto-play del
 *   coaching IA debe disparar solo cuando el conductor está parado —
 *   nunca al volante en movimiento. Este módulo implementa esa garantía.
 *
 * **Estrategia**:
 *   `navigator.geolocation.watchPosition()` reporta `coords.speed` en
 *   m/s. Convertimos a km/h y aplicamos un threshold ≤ 3 km/h ≈ caminar
 *   lento (un camión parado con motor encendido nunca llega a 3 km/h por
 *   GPS noise; un camión avanzando incluso lento sí). El threshold viene
 *   con histeresis para evitar flapping en idle con drift GPS.
 *
 * **Estados**:
 *   - `'unknown'`: aún no llegó la primera lectura, o el browser no
 *     reporta `speed` (algunos vehículos en interior).
 *   - `'denied'`: el usuario rechazó permisos. UX cae a "auto-play sólo
 *     manual" (la app no puede asumir parado sin lectura).
 *   - `'stopped'`: speed ≤ STOP_KMH durante ≥ HOLD_MS sostenido.
 *   - `'moving'`: speed > MOVE_KMH durante ≥ HOLD_MS sostenido.
 *
 * **Por qué histeresis (STOP_KMH=3 vs MOVE_KMH=8)**:
 *   Si usamos un solo threshold, un GPS con jitter típico de ±5 km/h
 *   alterna entre stopped/moving sin parar — y el auto-play arranca y
 *   se interrumpe. La banda muerta entre 3-8 km/h evita el flap.
 *
 * **No**:
 *   - Detección activa de "estoy manejando" via accelerómetro o sensor
 *     de movimiento del device. Privacy + complejidad. La velocidad GPS
 *     ya es suficiente para el caso de uso.
 *   - Buffer de promedio rolling sobre N lecturas. Cumple lo mismo que
 *     el HOLD_MS sostenido pero más complejo. Si en producción el flap
 *     persiste, agregar.
 */

/** Velocidad ≤ este valor en km/h durante HOLD_MS → 'stopped'. */
const STOP_KMH = 3;
/** Velocidad ≥ este valor en km/h durante HOLD_MS → 'moving'. */
const MOVE_KMH = 8;
/** Tiempo sostenido en cualquiera de los rangos antes de cambiar de estado. */
const HOLD_MS = 4000;

export type StoppedState = 'unknown' | 'stopped' | 'moving' | 'denied';

export interface StoppedDetector {
  /** Estado actual sincrónico. */
  getState: () => StoppedState;
  /**
   * Suscribe a cambios. El listener recibe el state actual al instante
   * de subscribe (igual que CoachingVoiceController.subscribe).
   * Devuelve unsubscribe.
   */
  subscribe: (listener: (state: StoppedState) => void) => () => void;
  /** Detiene el watch de geolocation. Idempotente. */
  stop: () => void;
}

/**
 * Convierte velocidad en m/s a km/h. Pure.
 *
 * `null`/`undefined` → `null` (significa "el browser no reportó speed";
 * no inferimos parado).
 */
export function speedMpsToKmh(speedMps: number | null | undefined): number | null {
  if (speedMps === null || speedMps === undefined || Number.isNaN(speedMps)) {
    return null;
  }
  // m/s × 3.6 = km/h. Speed negativa no tiene sentido (pero el browser
  // a veces reporta -1 cuando no sabe — tratar como null).
  if (speedMps < 0) {
    return null;
  }
  return speedMps * 3.6;
}

/**
 * Decide el próximo estado dado el estado actual + velocidad observada.
 *
 * Pure function — toda la lógica de histeresis vive acá. El detector
 * factory orquesta el timing (HOLD_MS) y el plumbing de geolocation.
 */
export function nextState(
  current: StoppedState,
  observedKmh: number | null,
): 'stopped' | 'moving' | 'unknown' | 'no-change' {
  if (observedKmh === null) {
    // Sin lectura — no movemos al state. Si era 'stopped' y se pierde
    // el GPS, mantenemos 'stopped' (más seguro que volver a 'unknown').
    return 'no-change';
  }
  if (observedKmh <= STOP_KMH) {
    return current === 'stopped' ? 'no-change' : 'stopped';
  }
  if (observedKmh >= MOVE_KMH) {
    return current === 'moving' ? 'no-change' : 'moving';
  }
  // Banda muerta (3 < kmh < 8) — mantenemos el estado actual.
  return 'no-change';
}

export interface CreateStoppedDetectorOpts {
  /**
   * Geolocation API. Default `navigator.geolocation`. Pasar `null`
   * explícitamente para tests / no-soporte.
   */
  geolocation?: Geolocation | null;
  /**
   * Para tests: factory de timers (default global setTimeout/clearTimeout).
   */
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  /** Override del HOLD_MS (default 4000). Útil para tests rápidos. */
  holdMs?: number;
}

/**
 * Crea un detector con `watchPosition`. El watch se mantiene activo
 * hasta `stop()`.
 *
 * Si geolocation no está disponible (o `null` explícito), el detector
 * inicia en 'unknown' y nunca cambia. Caller decide qué hacer con eso
 * (en el coaching player: gateamos auto-play hasta que sea 'stopped').
 */
export function createStoppedDetector(opts: CreateStoppedDetectorOpts = {}): StoppedDetector {
  const geo: Geolocation | null =
    'geolocation' in opts
      ? (opts.geolocation ?? null)
      : typeof navigator !== 'undefined' && typeof navigator.geolocation !== 'undefined'
        ? navigator.geolocation
        : null;
  const setTimeoutImpl = opts.setTimeoutFn ?? setTimeout;
  const clearTimeoutImpl = opts.clearTimeoutFn ?? clearTimeout;
  const holdMs = opts.holdMs ?? HOLD_MS;

  let state: StoppedState = 'unknown';
  const listeners = new Set<(s: StoppedState) => void>();
  let pendingTransition: {
    target: 'stopped' | 'moving';
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  let watchId: number | null = null;

  const setState = (next: StoppedState): void => {
    if (state === next) {
      return;
    }
    state = next;
    for (const l of listeners) {
      l(state);
    }
  };

  const cancelPending = (): void => {
    if (pendingTransition) {
      clearTimeoutImpl(pendingTransition.timer);
      pendingTransition = null;
    }
  };

  const handlePosition = (position: GeolocationPosition): void => {
    const kmh = speedMpsToKmh(position.coords.speed);
    const nxt = nextState(state, kmh);

    if (nxt === 'no-change') {
      // Si la observación reafirma el state actual o cae en banda muerta,
      // cancelamos cualquier pending hacia el opuesto.
      cancelPending();
      return;
    }

    // 'unknown' transition no aplica acá (solo lo seteamos al inicio).
    if (nxt === 'stopped' || nxt === 'moving') {
      // Si ya hay pending hacia el mismo target, dejarlo correr.
      if (pendingTransition?.target === nxt) {
        return;
      }
      cancelPending();
      pendingTransition = {
        target: nxt,
        timer: setTimeoutImpl(() => {
          setState(nxt);
          pendingTransition = null;
        }, holdMs),
      };
    }
  };

  const handleError = (err: GeolocationPositionError): void => {
    if (err.code === err.PERMISSION_DENIED) {
      cancelPending();
      setState('denied');
      // Stop el watch — no se va a recuperar sin acción del usuario.
      if (geo && watchId !== null) {
        try {
          geo.clearWatch(watchId);
        } catch {
          // ignore.
        }
        watchId = null;
      }
    }
    // POSITION_UNAVAILABLE / TIMEOUT son transitorios — no movemos state.
  };

  if (geo) {
    try {
      watchId = geo.watchPosition(handlePosition, handleError, {
        enableHighAccuracy: false,
        // 30s timeout es generoso — el auto-play no es time-critical.
        timeout: 30_000,
        maximumAge: 5_000,
      });
    } catch {
      // Algunos browsers tiran SecurityError si watchPosition no está
      // permitido en el contexto (e.g. no-HTTPS). Tratamos como denied.
      setState('denied');
    }
  }

  const stop = (): void => {
    cancelPending();
    if (geo && watchId !== null) {
      try {
        geo.clearWatch(watchId);
      } catch {
        // ignore.
      }
      watchId = null;
    }
  };

  const subscribe = (listener: (s: StoppedState) => void): (() => void) => {
    listeners.add(listener);
    listener(state);
    return () => {
      listeners.delete(listener);
    };
  };

  return { getState: () => state, subscribe, stop };
}
