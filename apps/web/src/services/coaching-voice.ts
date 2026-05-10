/**
 * Wrapper sobre Web Speech API (`speechSynthesis`) para reproducir el
 * coaching IA al conductor de manera hands-free.
 *
 * **Por qué no Google Cloud Text-to-Speech** (server-side):
 *   - Web Speech API es 100% client-side, sin coste por viaje.
 *   - Funciona offline una vez que el browser tiene la voz cargada.
 *   - Latencia 0 entre click → audio (vs ~500ms round-trip a backend TTS).
 *   - Voz nativa del OS — más natural en móviles modernos (iOS Siri,
 *     Android Google TTS) que un MP3 sintético genérico.
 *
 *   Trade-off: la calidad de voz varía por browser/OS. iOS Safari y
 *   Chrome desktop tienen voces excelentes en español; Firefox Linux es
 *   más robótica. Aceptable para el caso de uso (mensaje corto, datos
 *   operacionales, no entretenimiento).
 *
 * **API design**:
 *   - `pickSpanishVoice()`: elige la mejor voz disponible (es-CL > es-* > default).
 *     Pure function, testeable con stub de getVoices().
 *   - `createCoachingVoice()`: factoría que devuelve un controller con
 *     `play(text)`, `stop()`, `getState()` + `subscribe(cb)`. Encapsula la
 *     instancia única de `speechSynthesis` (singleton por design — el
 *     browser solo permite una utterance activa a la vez).
 *   - `loadAutoplayPreference()` / `saveAutoplayPreference()`: persist
 *     opt-in del conductor en localStorage. Default `false` (mute) por
 *     seguridad — el conductor ACTIVA, nunca asumimos.
 *
 * **No**:
 *   - Cola de utterances. Si el conductor toca play en el medio de un
 *     mensaje, cancelamos el actual y arrancamos el nuevo. Anti-frustración
 *     y simplifica state.
 *   - Volume / rate / pitch ajustables. Ruido excesivo de UI; usamos
 *     defaults sanos (rate=0.95 levemente más lento para claridad,
 *     pitch=1.0 normal, volume=1.0).
 */

const AUTOPLAY_KEY = 'booster:coaching-voice:autoplay-enabled';

export type VoiceState = 'idle' | 'speaking' | 'unsupported' | 'error';

export interface CoachingVoiceController {
  /**
   * Reproduce el texto. Si ya hay algo reproduciéndose, lo cancela y
   * arranca el nuevo. Si no hay soporte, no-op (el state queda en
   * 'unsupported' y el caller debe ocultarse/mostrar fallback visual).
   */
  play: (text: string) => void;
  /** Detiene la reproducción actual. */
  stop: () => void;
  /** Estado actual sincrónico (para UI inicial). */
  getState: () => VoiceState;
  /**
   * Suscribe a cambios de estado. Devuelve función unsubscribe. El
   * listener se llama ANTES del primer play() con el state actual.
   */
  subscribe: (listener: (state: VoiceState) => void) => () => void;
}

/**
 * Verdadero si el browser soporta speechSynthesis con al menos una voz.
 * Se evalúa al construir el controller — si despues de la construcción
 * cambia (extension instala una voz nueva), el caller debe re-construir.
 */
export function isSpeechSupported(): boolean {
  if (typeof window === 'undefined' || typeof window.speechSynthesis === 'undefined') {
    return false;
  }
  return true;
}

/**
 * Elige la mejor voz disponible para el coaching. Preferencias:
 *   1. es-CL (chileno nativo)
 *   2. es-MX, es-419 (latinoamericano — neutro pero entendible)
 *   3. es-ES (España — entendible aunque con seseo)
 *   4. cualquier es-*
 *   5. default voice del browser (último recurso)
 *
 * Función pura — recibe lista de voces, no consulta `speechSynthesis`.
 * Esto permite testear con fixtures.
 */
export function pickSpanishVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  if (voices.length === 0) {
    return null;
  }
  const byLang = (suffix: string): SpeechSynthesisVoice | undefined =>
    voices.find((v) => v.lang.toLowerCase() === suffix.toLowerCase()) ??
    voices.find((v) => v.lang.toLowerCase().startsWith(suffix.toLowerCase()));

  return (
    byLang('es-CL') ??
    byLang('es-MX') ??
    byLang('es-419') ??
    byLang('es-ES') ??
    voices.find((v) => v.lang.toLowerCase().startsWith('es')) ??
    voices.find((v) => v.default) ??
    voices[0] ??
    null
  );
}

/**
 * Devuelve la preferencia de auto-play del conductor. Default `false`:
 * NUNCA reproducimos audio sin click explícito en el primer uso.
 *
 * El conductor activa una vez en onboarding driver-mode (futuro PR), o
 * vía toggle en la configuración. Una vez ON, los próximos coachings se
 * disparan automáticamente al detectar entrega confirmada.
 */
export function loadAutoplayPreference(): boolean {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return false;
  }
  try {
    return window.localStorage.getItem(AUTOPLAY_KEY) === '1';
  } catch {
    // localStorage puede tirar SecurityError en private mode + Safari.
    return false;
  }
}

export function saveAutoplayPreference(enabled: boolean): void {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return;
  }
  try {
    if (enabled) {
      window.localStorage.setItem(AUTOPLAY_KEY, '1');
    } else {
      window.localStorage.removeItem(AUTOPLAY_KEY);
    }
  } catch {
    // ignore — autoplay default-false es safe.
  }
}

export interface CreateCoachingVoiceOpts {
  /**
   * Inyectable para tests. Default: `window.speechSynthesis`. Pasar
   * `null` explícitamente para forzar el state 'unsupported' en tests
   * que validan UI degradada (sin él, el `??` cae al window real).
   */
  synth?: SpeechSynthesis | null;
  /**
   * Inyectable para tests. Default: `window.SpeechSynthesisUtterance`.
   */
  UtteranceCtor?: typeof SpeechSynthesisUtterance | null;
  /**
   * Velocidad. Default 0.95 (levemente más lento que normal — al volante
   * el conductor no puede re-leer; preferimos claridad).
   */
  rate?: number;
}

export function createCoachingVoice(opts: CreateCoachingVoiceOpts = {}): CoachingVoiceController {
  // `null` explícito → forzar unsupported (tests). `undefined` → default
  // a window.* (prod). Distinguir con 'in' permite que el caller fuerce.
  const synth: SpeechSynthesis | null =
    'synth' in opts
      ? (opts.synth ?? null)
      : typeof window !== 'undefined' && typeof window.speechSynthesis !== 'undefined'
        ? window.speechSynthesis
        : null;
  const UtteranceCtor: typeof SpeechSynthesisUtterance | null =
    'UtteranceCtor' in opts
      ? (opts.UtteranceCtor ?? null)
      : typeof window !== 'undefined' && typeof window.SpeechSynthesisUtterance !== 'undefined'
        ? window.SpeechSynthesisUtterance
        : null;
  const rate = opts.rate ?? 0.95;

  let state: VoiceState = synth && UtteranceCtor ? 'idle' : 'unsupported';
  const listeners = new Set<(s: VoiceState) => void>();

  const setState = (next: VoiceState): void => {
    if (state === next) {
      return;
    }
    state = next;
    for (const l of listeners) {
      l(state);
    }
  };

  const play = (text: string): void => {
    if (state === 'unsupported' || !synth || !UtteranceCtor) {
      return;
    }
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      return;
    }

    // Si está hablando algo, cancelamos antes — el browser dispara
    // 'end' del actual y luego procesamos el nuevo. Esto previene
    // utterances apiladas en la cola del browser.
    try {
      synth.cancel();
    } catch {
      // ignore — cancel puede tirar en algunos browsers exóticos.
    }

    const utter = new UtteranceCtor(trimmed);
    utter.rate = rate;
    utter.pitch = 1.0;
    utter.volume = 1.0;
    utter.lang = 'es-CL';

    // Voice picking puede ser asíncrono en algunos browsers (Chrome
    // desktop emite 'voiceschanged' al cargar). Si getVoices() está
    // vacío al momento de crear utter, dejamos que el browser use el
    // default — mejor un audio en otro idioma que silencio.
    const voice = pickSpanishVoice(synth.getVoices());
    if (voice) {
      utter.voice = voice;
    }

    utter.onstart = () => setState('speaking');
    utter.onend = () => setState('idle');
    utter.onerror = (event) => {
      // 'canceled' / 'interrupted' son resultado esperable del cancel()
      // antes de play() — NO los tratamos como error.
      const errCode = event.error;
      if (errCode === 'canceled' || errCode === 'interrupted') {
        setState('idle');
        return;
      }
      setState('error');
    };

    try {
      synth.speak(utter);
    } catch {
      setState('error');
    }
  };

  const stop = (): void => {
    if (!synth) {
      return;
    }
    try {
      synth.cancel();
    } catch {
      // ignore.
    }
    setState('idle');
  };

  const getState = (): VoiceState => state;

  const subscribe = (listener: (s: VoiceState) => void): (() => void) => {
    listeners.add(listener);
    listener(state);
    return () => {
      listeners.delete(listener);
    };
  };

  return { play, stop, getState, subscribe };
}
