import { logger } from '../lib/logger.js';

/**
 * ADR-036 — Wake-word "Oye Booster" con Picovoice Porcupine (T10-22).
 *
 * Esta capa abstrae Porcupine para que el resto del código no dependa del
 * SDK y se pueda cambiar de proveedor sin tocar los call sites.
 *
 * - **Carga diferida**: el SDK (WASM) se importa con `import()` solo cuando
 *   el conductor activó el wake-word y el flag está encendido.
 * - **El micrófono se pide en `enable()`, no en `init()`**: `init` deja el
 *   motor listo; `enable` suscribe el worker a `WebVoiceProcessor`, que es
 *   quien abre el micrófono.
 * - **Gates** (ADR-036 §Activación condicionada): `pause(motivo)` suelta el
 *   micrófono mientras haya al menos un gate puesto (vehículo en movimiento,
 *   pestaña oculta); `resume(motivo)` quita ese gate.
 * - **Tras una detección** suelta el micrófono durante
 *   `pausaTrasDeteccionMs` para que el reconocedor de comandos (Web Speech)
 *   lo tenga libre, y después reanuda si sigue habilitado.
 * - **Privacidad verificable**: el audio se procesa on-device en WASM; el
 *   estado (`listening`/`paused`) es el real, y la UI lo muestra tal cual.
 */

export type WakeWordState =
  | 'idle' // sin escuchar (no iniciado, listo sin habilitar, o deshabilitado)
  | 'initializing' // cargando SDK + modelo
  | 'listening' // micrófono abierto, escuchando "Oye Booster"
  | 'paused' // habilitado pero con un gate puesto (movimiento, pestaña oculta)
  | 'detected' // recién detectado; micrófono cedido al reconocedor de comandos
  | 'unavailable' // sin AccessKey, sin modelo o sin WebAssembly
  | 'error'; // falla de carga, de micrófono o del motor

export interface WakeWordEventMap {
  state: WakeWordState;
  detection: { timestamp: number };
  error: { message: string };
}

export type WakeWordListener<K extends keyof WakeWordEventMap> = (
  payload: WakeWordEventMap[K],
) => void;

export interface WakeWordOptions {
  /** AccessKey de Picovoice Console. Llega en runtime desde `GET /me/wake-word`. */
  accessKey: string;
  /** URL del modelo de la keyword custom (`oye-booster-cl.ppn`). */
  keywordPath: string;
  /** URL del modelo de parámetros en español (`porcupine_params_es.pv`). */
  modelPath: string;
  /** Sensibilidad 0..1 (Porcupine usa 0,5 por omisión). */
  sensitivity?: number;
  /** Se llama en cada detección. Debe ser rápida e idempotente. */
  onWake: () => void;
}

export interface WakeWordController {
  state: WakeWordState;
  init(opts: WakeWordOptions): Promise<void>;
  /** El caller quiere el listener activo apenas no haya gates. */
  enable(): void;
  /** Pone un gate: suelta el micrófono sin perder la intención de `enable`. */
  pause(reason: string): void;
  /** Quita el gate `reason` (o todos si no se indica). */
  resume(reason?: string): void;
  /** El conductor apagó el toggle: suelta el micrófono. */
  disable(): void;
  destroy(): Promise<void>;
  on<K extends keyof WakeWordEventMap>(event: K, fn: WakeWordListener<K>): () => void;
}

// --- Subconjunto del SDK que usa el controlador ------------------------------

export interface ModeloPorcupine {
  publicPath: string;
  customWritePath: string;
}

export interface PalabraClavePorcupine extends ModeloPorcupine {
  label: string;
  sensitivity: number;
}

export interface DeteccionPorcupine {
  index: number;
  label: string;
}

export interface WorkerPorcupine {
  release(): Promise<void>;
  terminate(): void;
}

export interface SdkPorcupine {
  PorcupineWorker: {
    create(
      accessKey: string,
      keyword: PalabraClavePorcupine,
      onDetection: (d: DeteccionPorcupine) => void,
      model: ModeloPorcupine,
      options?: { processErrorCallback?: (error: Error) => void },
    ): Promise<WorkerPorcupine>;
  };
  WebVoiceProcessor: {
    subscribe(worker: WorkerPorcupine): Promise<void>;
    unsubscribe(worker: WorkerPorcupine): Promise<void>;
  };
}

/** Carga real del SDK, en un chunk aparte (~700 KB con WASM). */
const cargarSdkPicovoice = async (): Promise<SdkPorcupine> =>
  (await import('./wake-word-sdk.js')).cargarSdkPicovoice();

const KEYWORD_LABEL = 'oye-booster';
const SENSIBILIDAD_POR_OMISION = 0.5;
const PAUSA_TRAS_DETECCION_MS = 8000;

export interface CreateWakeWordControllerOpts {
  /** Inyectable para tests: por omisión importa `@picovoice/*`. */
  cargarSdk?: () => Promise<SdkPorcupine>;
  /** Por omisión, `typeof WebAssembly === 'object'`. */
  soportaWasm?: () => boolean;
  pausaTrasDeteccionMs?: number;
}

const mensajeDe = (err: unknown): string => (err instanceof Error ? err.message : String(err));

class PorcupineWakeWordController implements WakeWordController {
  state: WakeWordState = 'idle';
  private readonly listeners = new Map<
    keyof WakeWordEventMap,
    Set<WakeWordListener<keyof WakeWordEventMap>>
  >();
  private sdk: SdkPorcupine | null = null;
  private worker: WorkerPorcupine | null = null;
  private onWake: (() => void) | null = null;
  private quiereActivo = false;
  private readonly gates = new Set<string>();
  private suscrito = false;
  private trasDeteccion = false;
  private timerTrasDeteccion: ReturnType<typeof setTimeout> | null = null;
  private destruido = false;

  constructor(
    private readonly cargarSdk: () => Promise<SdkPorcupine>,
    private readonly soportaWasm: () => boolean,
    private readonly pausaTrasDeteccionMs: number,
  ) {}

  async init(opts: WakeWordOptions): Promise<void> {
    this.onWake = opts.onWake;
    if (!opts.accessKey || !opts.keywordPath || !opts.modelPath) {
      this.marcarNoDisponible('Wake-word no disponible: falta la AccessKey o el modelo.');
      return;
    }
    if (!this.soportaWasm()) {
      this.marcarNoDisponible('Wake-word no disponible: este navegador no soporta WebAssembly.');
      return;
    }
    this.setState('initializing');
    try {
      const sdk = await this.cargarSdk();
      const worker = await sdk.PorcupineWorker.create(
        opts.accessKey,
        {
          publicPath: opts.keywordPath,
          customWritePath: opts.keywordPath,
          label: KEYWORD_LABEL,
          sensitivity: opts.sensitivity ?? SENSIBILIDAD_POR_OMISION,
        },
        () => this.alDetectar(),
        { publicPath: opts.modelPath, customWritePath: opts.modelPath },
        { processErrorCallback: (error) => this.fallar(error) },
      );
      if (this.destruido) {
        await this.liberar(worker);
        return;
      }
      this.sdk = sdk;
      this.worker = worker;
      this.setState('idle');
      this.sincronizar();
    } catch (err) {
      this.fallar(err);
    }
  }

  enable(): void {
    if (this.state === 'unavailable' || this.state === 'error') {
      return;
    }
    this.quiereActivo = true;
    this.sincronizar();
  }

  pause(reason: string): void {
    this.gates.add(reason);
    this.sincronizar();
  }

  resume(reason?: string): void {
    if (reason === undefined) {
      this.gates.clear();
    } else {
      this.gates.delete(reason);
    }
    this.sincronizar();
  }

  disable(): void {
    this.quiereActivo = false;
    this.cancelarTrasDeteccion();
    this.sincronizar();
  }

  async destroy(): Promise<void> {
    this.destruido = true;
    this.cancelarTrasDeteccion();
    const { sdk, worker } = this;
    this.sdk = null;
    this.worker = null;
    this.listeners.clear();
    this.onWake = null;
    this.state = 'idle';
    if (sdk && worker && this.suscrito) {
      this.suscrito = false;
      await sdk.WebVoiceProcessor.unsubscribe(worker).catch((err: unknown) => {
        logger.warn({ error: mensajeDe(err) }, 'wake-word: no se pudo soltar el micrófono');
      });
    }
    if (worker) {
      await this.liberar(worker);
    }
  }

  on<K extends keyof WakeWordEventMap>(event: K, fn: WakeWordListener<K>): () => void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(fn as WakeWordListener<keyof WakeWordEventMap>);
    this.listeners.set(event, set);
    return () => {
      this.listeners.get(event)?.delete(fn as WakeWordListener<keyof WakeWordEventMap>);
    };
  }

  /**
   * Alinea la suscripción al micrófono con la intención y los gates, y
   * deriva el estado visible. Único lugar que suscribe o desuscribe.
   */
  private sincronizar(): void {
    const { sdk, worker } = this;
    if (!sdk || !worker || this.destruido || this.state === 'error') {
      return;
    }
    const debeEscuchar = this.quiereActivo && this.gates.size === 0 && !this.trasDeteccion;
    if (debeEscuchar && !this.suscrito) {
      this.suscrito = true;
      sdk.WebVoiceProcessor.subscribe(worker).then(
        () => {
          if (this.suscrito && !this.destruido) {
            this.setState('listening');
          }
        },
        (err: unknown) => {
          this.suscrito = false;
          this.fallar(err);
        },
      );
      return;
    }
    if (!debeEscuchar && this.suscrito) {
      this.suscrito = false;
      sdk.WebVoiceProcessor.unsubscribe(worker).catch((err: unknown) => this.fallar(err));
    }
    if (!debeEscuchar) {
      if (this.trasDeteccion) {
        this.setState('detected');
      } else if (this.quiereActivo) {
        this.setState('paused');
      } else {
        this.setState('idle');
      }
    }
  }

  private alDetectar(): void {
    if (this.destruido) {
      return;
    }
    this.emit('detection', { timestamp: Date.now() });
    try {
      this.onWake?.();
    } catch (err) {
      logger.error({ error: mensajeDe(err) }, 'wake-word: onWake falló');
    }
    this.trasDeteccion = true;
    this.sincronizar();
    this.timerTrasDeteccion = setTimeout(() => {
      this.timerTrasDeteccion = null;
      this.trasDeteccion = false;
      this.sincronizar();
    }, this.pausaTrasDeteccionMs);
  }

  private cancelarTrasDeteccion(): void {
    if (this.timerTrasDeteccion) {
      clearTimeout(this.timerTrasDeteccion);
      this.timerTrasDeteccion = null;
    }
    this.trasDeteccion = false;
  }

  private async liberar(worker: WorkerPorcupine): Promise<void> {
    try {
      await worker.release();
    } catch (err) {
      logger.warn({ error: mensajeDe(err) }, 'wake-word: release del worker falló');
    }
    worker.terminate();
  }

  private marcarNoDisponible(message: string): void {
    this.setState('unavailable');
    this.emit('error', { message });
  }

  private fallar(err: unknown): void {
    const message = mensajeDe(err);
    logger.error({ error: message }, 'wake-word: falla del motor');
    this.setState('error');
    this.emit('error', { message });
  }

  private setState(s: WakeWordState): void {
    if (this.state === s) {
      return;
    }
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
      } catch (err) {
        // Un listener roto no corta al resto, pero queda registrado.
        logger.error({ error: mensajeDe(err), event }, 'wake-word: listener falló');
      }
    }
  }
}

/** Único punto de creación: permite cambiar de proveedor sin tocar call sites. */
export function createWakeWordController(
  opts: CreateWakeWordControllerOpts = {},
): WakeWordController {
  return new PorcupineWakeWordController(
    opts.cargarSdk ?? cargarSdkPicovoice,
    opts.soportaWasm ?? (() => typeof WebAssembly === 'object'),
    opts.pausaTrasDeteccionMs ?? PAUSA_TRAS_DETECCION_MS,
  );
}
