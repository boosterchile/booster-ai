/**
 * Recognizer de comandos por voz para el conductor (Phase 4 PR-K2).
 *
 * Capa de framework — este módulo expone:
 *   1. `parseCommand(transcript)` — parser puro que mapea transcript a
 *      uno de los intents soportados (confirmar entrega, marcar
 *      incidente, etc.). Pure function, testeable sin browser.
 *   2. `createVoiceCommandRecognizer(opts)` — factoría que wrappea Web
 *      Speech Recognition API en un controller con DI. Push-to-talk:
 *      el caller llama `start()` cuando el usuario presiona el botón;
 *      el recognizer escucha hasta que el usuario suelta o detecta
 *      silencio.
 *
 * **Por qué push-to-talk y no continuous**:
 *   - Privacy: continuous recognition = mic siempre abierto, cualquier
 *     conversación se transcribe. Inaceptable en cabina compartida.
 *   - Battery: continuous recognition consume sustancial.
 *   - Falsos positivos: un conductor hablando con un destinatario por
 *     teléfono podría disparar comandos.
 *   - El conductor presiona un botón grande, da el comando, listo.
 *
 * **Vocabulario en es-CL**:
 *   El parser cubre sinónimos del habla chilena natural ("entregue",
 *   "ya entregué", "tomo la oferta"). No es exhaustivo — empezamos con
 *   los tokens canónicos y agregamos según observamos en producción
 *   (la transcript se loguea para análisis, sin PII).
 *
 * **Browsers soportados**:
 *   - Chrome desktop + Android: ✓ (SpeechRecognition con prefix
 *     webkitSpeechRecognition)
 *   - Edge: ✓
 *   - Safari iOS 14.5+: ✓
 *   - Firefox: ✗ (sin soporte W3C Speech Recognition; degradación
 *     graceful — el botón de voz se oculta)
 */

export type CommandIntent =
  | 'confirmar_entrega'
  | 'marcar_incidente'
  | 'aceptar_oferta'
  | 'cancelar'
  | 'repetir';

export interface RecognizedCommand {
  /** Intent identificado del transcript. */
  intent: CommandIntent;
  /** Transcript original tal como lo devolvió el browser (lowercase). */
  transcript: string;
  /** Confianza reportada por el browser (0..1). 1.0 si no está disponible. */
  confidence: number;
}

export type RecognitionState =
  | 'idle' // Listo. No escucha.
  | 'listening' // Mic abierto, transcribiendo.
  | 'processing' // Recibió un final result, parseando.
  | 'unsupported' // Browser sin Web Speech Recognition.
  | 'error'; // Mic denegado u otro error fatal.

// ---------------------------------------------------------------------------
// Parser puro
// ---------------------------------------------------------------------------

interface IntentPattern {
  intent: CommandIntent;
  /**
   * Tokens (palabras o frases cortas) que disparan el intent. Coinciden
   * con \b boundaries para no matchear sub-strings (ej. "no" no matchea
   * dentro de "noche").
   */
  tokens: string[];
}

/**
 * Orden importa: si un transcript contiene tokens de varios intents
 * (ej. "cancelar la oferta"), el primer match gana. Por eso pones
 * `cancelar` antes de `aceptar_oferta` — un "cancelar la oferta" debe
 * leerse como cancelación, no aceptación.
 */
const PATTERNS: IntentPattern[] = [
  // Cancelar: priority alta porque puede aparecer junto con cualquier otro
  // verbo y debe interpretarse como abort.
  {
    intent: 'cancelar',
    tokens: ['cancelar', 'cancelo', 'detener', 'detente', 'parar', 'olvídalo', 'olvidalo'],
  },
  {
    intent: 'confirmar_entrega',
    tokens: [
      'confirmar entrega',
      'confirmo entrega',
      'entrega confirmada',
      'ya entregué',
      'ya entregue',
      'entregue',
      'entregado',
      'entregada',
      'listo entrega',
    ],
  },
  {
    intent: 'marcar_incidente',
    tokens: ['incidente', 'reportar problema', 'reportar incidente', 'tengo un problema'],
  },
  {
    intent: 'aceptar_oferta',
    tokens: [
      'aceptar oferta',
      'acepto oferta',
      'acepto la oferta',
      'tomar oferta',
      'tomo la oferta',
      'tomo oferta',
    ],
  },
  {
    intent: 'repetir',
    tokens: ['repetir', 'repíteme', 'repiteme', 'otra vez', 'de nuevo'],
  },
];

/** Escapa caracteres especiales para uso en RegExp. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Parsea un transcript a un comando reconocido o devuelve `null` si
 * ningún intent matchea. Pure — sin side effects.
 *
 * El matching es case-insensitive, con boundaries de palabra. Para
 * frases multi-palabra (ej. "confirmar entrega") permitimos cualquier
 * cantidad de whitespace entre palabras pero exige el orden.
 */
export function parseCommand(transcript: string, confidence = 1.0): RecognizedCommand | null {
  const normalized = transcript.toLowerCase().trim();
  if (normalized.length === 0) {
    return null;
  }

  for (const { intent, tokens } of PATTERNS) {
    for (const token of tokens) {
      // Frases multi-palabra: tolerar whitespace flexible entre palabras.
      // Single-word: word boundary.
      const escaped = escapeRegex(token);
      const pattern = token.includes(' ') ? escaped.replace(/\\? /g, '\\s+') : `\\b${escaped}\\b`;
      const re = new RegExp(pattern, 'i');
      if (re.test(normalized)) {
        return { intent, transcript: normalized, confidence };
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Recognizer factory (Web Speech Recognition wrapper)
// ---------------------------------------------------------------------------

/**
 * Subset de la interfaz `SpeechRecognition` que usamos. Definir un type
 * propio evita el lío de webkitSpeechRecognition vs SpeechRecognition
 * (ambos comparten esta forma) y permite tests con stubs simples.
 */
export interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onnomatch: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export interface SpeechRecognitionEventLike {
  results: ArrayLike<{
    isFinal: boolean;
    length: number;
    [index: number]: { transcript: string; confidence: number };
  }>;
  resultIndex: number;
}

export interface SpeechRecognitionErrorEventLike {
  /** 'no-speech' | 'aborted' | 'audio-capture' | 'network' | 'not-allowed' | 'service-not-allowed' | 'bad-grammar' | 'language-not-supported' */
  error: string;
}

export interface VoiceCommandController {
  /**
   * Comienza a escuchar (mic open). Si ya está escuchando, no-op. Si
   * está en 'unsupported', no-op silencioso (el caller ya debe haberse
   * ocultado).
   */
  start: () => void;
  /** Detiene el listening sin abortar (procesa lo que ya tenía). */
  stop: () => void;
  /** Aborta inmediatamente, descartando lo que estaba transcribiendo. */
  abort: () => void;
  /** Estado sincrónico. */
  getState: () => RecognitionState;
  /** Suscribe a cambios de state. */
  subscribe: (listener: (state: RecognitionState) => void) => () => void;
  /**
   * Suscribe a comandos reconocidos (final results parseados). Se
   * dispara cuando el browser entrega un final result Y el parser
   * matchea un intent. Final results sin match disparan onUnrecognized.
   */
  onCommand: (listener: (cmd: RecognizedCommand) => void) => () => void;
  /**
   * Suscribe a final results que NO matchearon ningún intent. Útil
   * para feedback al usuario ("no entendí") + analytics de transcript
   * para mejorar el vocabulario del parser.
   */
  onUnrecognized: (listener: (transcript: string) => void) => () => void;
}

export interface CreateVoiceCommandRecognizerOpts {
  /**
   * Constructor de SpeechRecognition. Default: el del browser (con
   * fallback a webkitSpeechRecognition). Pasar `null` para forzar
   * unsupported (tests).
   */
  RecognitionCtor?: (new () => SpeechRecognitionLike) | null;
  /** Idioma. Default 'es-CL'. */
  lang?: string;
}

/**
 * Resuelve el constructor de SpeechRecognition desde el browser.
 * Devuelve null si no está soportado.
 */
function resolveRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') {
    return null;
  }
  // biome-ignore lint/suspicious/noExplicitAny: webkit prefix is browser-specific
  const w = window as unknown as { SpeechRecognition?: any; webkitSpeechRecognition?: any };
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as
    | (new () => SpeechRecognitionLike)
    | null;
}

export function createVoiceCommandRecognizer(
  opts: CreateVoiceCommandRecognizerOpts = {},
): VoiceCommandController {
  const Ctor: (new () => SpeechRecognitionLike) | null =
    'RecognitionCtor' in opts ? (opts.RecognitionCtor ?? null) : resolveRecognitionCtor();
  const lang = opts.lang ?? 'es-CL';

  let state: RecognitionState = Ctor ? 'idle' : 'unsupported';
  const stateListeners = new Set<(s: RecognitionState) => void>();
  const commandListeners = new Set<(c: RecognizedCommand) => void>();
  const unrecognizedListeners = new Set<(t: string) => void>();
  let recognizer: SpeechRecognitionLike | null = null;

  const setState = (next: RecognitionState): void => {
    if (state === next) {
      return;
    }
    state = next;
    for (const l of stateListeners) {
      l(state);
    }
  };

  const ensureRecognizer = (): SpeechRecognitionLike | null => {
    if (!Ctor) {
      return null;
    }
    if (recognizer) {
      return recognizer;
    }
    const r = new Ctor();
    r.lang = lang;
    r.interimResults = false;
    r.continuous = false;
    r.maxAlternatives = 1;

    r.onstart = () => setState('listening');
    r.onend = () => {
      // Si terminó sin error, volvemos a idle. Si estamos en error,
      // el handler de onerror ya seteó.
      if (state === 'listening' || state === 'processing') {
        setState('idle');
      }
    };
    r.onerror = (event) => {
      const code = event.error;
      // 'no-speech' / 'aborted' son resultados esperables de stop()
      // o silencio prolongado — no los marcamos como error.
      if (code === 'no-speech' || code === 'aborted') {
        setState('idle');
        return;
      }
      setState('error');
    };
    r.onresult = (event) => {
      // Final results: tomamos el último (resultIndex). Buscamos
      // alternativas con mayor confidence. Como interimResults=false,
      // todos los results en este evento son final.
      const result = event.results[event.resultIndex];
      if (!result || !result.isFinal || result.length === 0) {
        return;
      }
      const alt = result[0];
      if (!alt) {
        return;
      }

      setState('processing');

      const cmd = parseCommand(alt.transcript, alt.confidence ?? 1.0);
      if (cmd) {
        for (const l of commandListeners) {
          l(cmd);
        }
      } else {
        for (const l of unrecognizedListeners) {
          l(alt.transcript);
        }
      }

      // El browser disparará onend después; ahí volvemos a idle.
    };
    r.onnomatch = () => {
      setState('idle');
    };
    recognizer = r;
    return r;
  };

  const start = (): void => {
    if (state === 'unsupported') {
      return;
    }
    if (state === 'listening' || state === 'processing') {
      return;
    }
    const r = ensureRecognizer();
    if (!r) {
      return;
    }
    try {
      r.start();
    } catch {
      // 'InvalidStateError' si ya está listening (race entre user y
      // browser). No es fatal — el state listener convergerá.
      setState('error');
    }
  };

  const stop = (): void => {
    if (!recognizer) {
      return;
    }
    try {
      recognizer.stop();
    } catch {
      // ignore.
    }
  };

  const abort = (): void => {
    if (!recognizer) {
      return;
    }
    try {
      recognizer.abort();
    } catch {
      // ignore.
    }
    setState('idle');
  };

  const subscribe = (listener: (s: RecognitionState) => void): (() => void) => {
    stateListeners.add(listener);
    listener(state);
    return () => {
      stateListeners.delete(listener);
    };
  };

  const onCommand = (listener: (c: RecognizedCommand) => void): (() => void) => {
    commandListeners.add(listener);
    return () => {
      commandListeners.delete(listener);
    };
  };

  const onUnrecognized = (listener: (t: string) => void): (() => void) => {
    unrecognizedListeners.add(listener);
    return () => {
      unrecognizedListeners.delete(listener);
    };
  };

  return {
    start,
    stop,
    abort,
    getState: () => state,
    subscribe,
    onCommand,
    onUnrecognized,
  };
}
