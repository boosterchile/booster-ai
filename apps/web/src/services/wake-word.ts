/**
 * ADR-036 — Wake-word "Oye Booster" service wrapper.
 *
 * Esta capa abstrae Picovoice Porcupine para que el resto del código no
 * dependa directamente del SDK. Permite swap del provider futuro (si
 * cambia la decisión comercial) sin tocar los call sites.
 *
 * Por qué wrapper en vez de uso directo de `@picovoice/porcupine-web`:
 *   - **Lazy loading**: el SDK es ~700 KB. Solo cargamos cuando el
 *     usuario tiene wake-word ON. Evitamos costo en first paint para
 *     usuarios que no lo usan (default OFF).
 *   - **Lifecycle gating**: integramos con el stopped-detector para
 *     auto-pause cuando el vehículo se mueve, sin que el call site
 *     tenga que orquestar dos servicios.
 *   - **Testability**: los call sites usan esta API; los tests mockean
 *     este módulo en vez de Porcupine internals.
 *   - **Privacy hook**: registramos cada start/stop para que la UI
 *     muestre estado verificable (el conductor puede ver "mic activo /
 *     mic pausado por movimiento" en la card).
 *
 * Implementación actual (Wave 5 PR 1):
 *   - **Stub** que expone la API. La integración real con Porcupine
 *     entra en Wave 5 PR 2 cuando tengamos:
 *     1. Cuenta Picovoice + access key (env var
 *        `PICOVOICE_ACCESS_KEY`).
 *     2. Modelo `oye-booster-cl.ppn` entrenado en Picovoice Console.
 *   - El stub registra calls + dispatcha eventos vacíos para que la UI
 *     pueda renderizar el estado y los tests del hook puedan verificar
 *     el wiring sin levantar el SDK pesado.
 */

export type WakeWordState =
  | 'idle' // no iniciado
  | 'initializing' // cargando SDK + modelo
  | 'listening' // escuchando para "Oye Booster"
  | 'paused' // pausado por gate (movimiento o pantalla apagada)
  | 'detected' // wake-word recién detectado (transient ~100ms)
  | 'unavailable' // browser no soporta (sin WebAssembly SIMD)
  | 'error'; // falla de init o runtime

export interface WakeWordEventMap {
  state: WakeWordState;
  detection: { timestamp: number };
  error: { message: string };
}

export type WakeWordListener<K extends keyof WakeWordEventMap> = (
  payload: WakeWordEventMap[K],
) => void;

/**
 * Configuración para inicializar el wake-word listener.
 */
export interface WakeWordOptions {
  /**
   * Picovoice Access Key. Provisto via env var en build time o env-runtime.
   * Si falta, `init()` resuelve a estado `'unavailable'`.
   */
  accessKey: string;
  /**
   * Path al modelo .ppn del wake-word custom (e.g.
   * `/wake-word/oye-booster-cl.ppn`). En PR 1 todavía no tenemos modelo
   * custom — se acepta vacío y cae a fallback unavailable.
   */
  modelPath: string;
  /**
   * Callback que la UI registra para reaccionar a la detección.
   */
  onWake: () => void;
}

/**
 * Interface del wrapper. Implementación real swap-eable.
 */
export interface WakeWordController {
  state: WakeWordState;
  init(opts: WakeWordOptions): Promise<void>;
  /**
   * Marca al controller para que active el listener apenas las
   * precondiciones se cumplan (mic granted + vehicle stopped + page
   * visible). Es declarativo: el caller dice "quiero esto activo".
   */
  enable(): void;
  /**
   * Pausa por gate externo (vehicle moving, page hidden). NO desactiva
   * la intención; reactiva en cuanto el gate se libera.
   */
  pause(reason: string): void;
  resume(): void;
  /**
   * Desactiva el controller. El caller usa esto cuando el usuario
   * apaga el toggle. Libera mic + SDK.
   */
  disable(): void;
  destroy(): Promise<void>;
  on<K extends keyof WakeWordEventMap>(event: K, fn: WakeWordListener<K>): () => void;
}

/**
 * Implementación stub para Wave 5 PR 1. Expone la API y los eventos
 * pero NO toca el micrófono ni carga el SDK. La integración real
 * con Porcupine entra en PR 2 cuando el access key + modelo custom
 * estén disponibles.
 *
 * El stub resuelve a `'unavailable'` siempre que `init()` se llame,
 * porque sin access key real no hay funcionalidad real que entregar.
 * Esto deja la UI mostrando el banner "próximamente" sin romper.
 */
class StubWakeWordController implements WakeWordController {
  state: WakeWordState = 'idle';
  private listeners = new Map<
    keyof WakeWordEventMap,
    Set<WakeWordListener<keyof WakeWordEventMap>>
  >();
  /**
   * Callback registrado en init(). PR 1: el stub no lo dispara nunca (no
   * hay listener real). PR 2: lo llama desde el handler de Porcupine
   * cuando se detecte el wake-word.
   */
  private onWakeFn: (() => void) | null = null;

  async init(opts: WakeWordOptions): Promise<void> {
    this.onWakeFn = opts.onWake;
    // Silencia warn TS6133 hasta PR 2 — referencia explícita.
    void this.onWakeFn;
    if (!opts.accessKey || !opts.modelPath) {
      this.setState('unavailable');
      this.emit('error', {
        message: 'Wake-word no disponible — modelo en entrenamiento (Wave 5 PR 2).',
      });
      return;
    }
    // PR 2: cargar Porcupine acá. Por ahora marcamos unavailable.
    this.setState('unavailable');
  }

  enable(): void {
    if (this.state === 'unavailable') {
      return;
    }
    this.setState('listening');
  }

  pause(_reason: string): void {
    if (this.state === 'listening') {
      this.setState('paused');
    }
  }

  resume(): void {
    if (this.state === 'paused') {
      this.setState('listening');
    }
  }

  disable(): void {
    if (this.state !== 'unavailable') {
      this.setState('idle');
    }
  }

  async destroy(): Promise<void> {
    this.listeners.clear();
    this.onWakeFn = null;
    this.state = 'idle';
  }

  on<K extends keyof WakeWordEventMap>(event: K, fn: WakeWordListener<K>): () => void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(fn as WakeWordListener<keyof WakeWordEventMap>);
    this.listeners.set(event, set);
    return () => {
      const s = this.listeners.get(event);
      s?.delete(fn as WakeWordListener<keyof WakeWordEventMap>);
    };
  }

  private setState(s: WakeWordState): void {
    this.state = s;
    this.emit('state', s);
  }

  private emit<K extends keyof WakeWordEventMap>(event: K, payload: WakeWordEventMap[K]): void {
    const set = this.listeners.get(event);
    if (!set) {
      return;
    }
    for (const fn of set) {
      try {
        (fn as WakeWordListener<K>)(payload);
      } catch {
        // Swallow listener errors para no romper el broadcaster.
      }
    }
  }
}

/**
 * Factory pública. Único punto de creación. Permite swap del provider
 * sin tocar call sites.
 */
export function createWakeWordController(): WakeWordController {
  return new StubWakeWordController();
}

// Re-export del tipo public para que tests externos puedan stub.
export type { StubWakeWordController };
