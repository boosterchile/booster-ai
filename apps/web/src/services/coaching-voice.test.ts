import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCoachingVoice,
  isSpeechSupported,
  loadAutoplayPreference,
  pickSpanishVoice,
  saveAutoplayPreference,
} from './coaching-voice.js';

/** Stub mínimo de SpeechSynthesisVoice. */
function v(lang: string, name = lang, isDefault = false): SpeechSynthesisVoice {
  return {
    voiceURI: name,
    name,
    lang,
    default: isDefault,
    localService: true,
  } as SpeechSynthesisVoice;
}

describe('pickSpanishVoice', () => {
  it('devuelve null si no hay voces', () => {
    expect(pickSpanishVoice([])).toBeNull();
  });

  it('prefiere es-CL exact si existe', () => {
    const voices = [v('en-US', 'English'), v('es-MX', 'Mexican'), v('es-CL', 'Chilean')];
    expect(pickSpanishVoice(voices)?.lang).toBe('es-CL');
  });

  it('cae a es-MX si no hay es-CL', () => {
    const voices = [v('en-US'), v('es-MX'), v('es-ES')];
    expect(pickSpanishVoice(voices)?.lang).toBe('es-MX');
  });

  it('cae a es-419 si no hay es-CL/MX', () => {
    const voices = [v('en-US'), v('es-419'), v('es-ES')];
    expect(pickSpanishVoice(voices)?.lang).toBe('es-419');
  });

  it('cae a es-ES si no hay LATAM', () => {
    const voices = [v('en-US'), v('es-ES')];
    expect(pickSpanishVoice(voices)?.lang).toBe('es-ES');
  });

  it('matchea cualquier es-* prefix si no hay específicos', () => {
    const voices = [v('en-US'), v('es-AR-1', 'Argentine')];
    // ningún byLang directo, pero startsWith('es') captura.
    expect(pickSpanishVoice(voices)?.lang).toBe('es-AR-1');
  });

  it('cae a default voice si no hay español', () => {
    const voices = [v('fr-FR'), v('en-US', 'EN', true)];
    expect(pickSpanishVoice(voices)?.lang).toBe('en-US');
  });

  it('cae a primera voz si no hay español ni default', () => {
    const voices = [v('fr-FR'), v('en-US')];
    expect(pickSpanishVoice(voices)?.lang).toBe('fr-FR');
  });

  it('matching es case-insensitive', () => {
    const voices = [v('ES-cl'), v('en-US')];
    expect(pickSpanishVoice(voices)?.lang).toBe('ES-cl');
  });
});

describe('autoplay preference', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('default false cuando no hay nada en localStorage', () => {
    expect(loadAutoplayPreference()).toBe(false);
  });

  it('save true → load true', () => {
    saveAutoplayPreference(true);
    expect(loadAutoplayPreference()).toBe(true);
  });

  it('save false elimina la key (default off)', () => {
    saveAutoplayPreference(true);
    saveAutoplayPreference(false);
    expect(window.localStorage.getItem('booster:coaching-voice:autoplay-enabled')).toBeNull();
    expect(loadAutoplayPreference()).toBe(false);
  });

  it('robusto si localStorage tira (private mode)', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError');
    });
    expect(() => saveAutoplayPreference(true)).not.toThrow();
    setItemSpy.mockRestore();
  });
});

describe('isSpeechSupported', () => {
  it('true en jsdom (window.speechSynthesis polyfilled por nuestro setup)', () => {
    // jsdom no provee speechSynthesis nativo; lo stubeamos para simular soporte.
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: { getVoices: () => [], cancel: () => undefined, speak: () => undefined },
    });
    expect(isSpeechSupported()).toBe(true);
  });

  it('false si window.speechSynthesis no existe', () => {
    const original = (window as { speechSynthesis?: SpeechSynthesis }).speechSynthesis;
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: undefined,
    });
    expect(isSpeechSupported()).toBe(false);
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: original,
    });
  });
});

describe('createCoachingVoice', () => {
  /** Mock instalable de SpeechSynthesis. */
  function makeSynthMock(voices: SpeechSynthesisVoice[] = [v('es-CL')]) {
    return {
      cancel: vi.fn(),
      speak: vi.fn(),
      getVoices: vi.fn(() => voices),
      pause: vi.fn(),
      resume: vi.fn(),
      paused: false,
      pending: false,
      speaking: false,
    } as unknown as SpeechSynthesis;
  }

  /** Mock del constructor SpeechSynthesisUtterance que captura lo creado. */
  function makeUtteranceCtor() {
    interface UtterCaptured {
      text: string;
      lang?: string;
      voice?: SpeechSynthesisVoice;
      rate?: number;
      pitch?: number;
      volume?: number;
      onstart?: () => void;
      onend?: () => void;
      onerror?: (e: { error: string }) => void;
    }
    const created: UtterCaptured[] = [];
    // Class-style mock para que `new Ctor(...)` funcione (vi.fn no se
    // puede invocar con `new` salvo que sea una clase).
    class Ctor implements UtterCaptured {
      text: string;
      lang?: string;
      voice?: SpeechSynthesisVoice;
      rate?: number;
      pitch?: number;
      volume?: number;
      onstart?: () => void;
      onend?: () => void;
      onerror?: (e: { error: string }) => void;
      constructor(text: string) {
        this.text = text;
        created.push(this);
      }
    }
    return { Ctor: Ctor as unknown as typeof SpeechSynthesisUtterance, created };
  }

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('estado inicial: idle si synth + Utterance están', () => {
    const synth = makeSynthMock();
    const { Ctor } = makeUtteranceCtor();
    const voice = createCoachingVoice({ synth, UtteranceCtor: Ctor });
    expect(voice.getState()).toBe('idle');
  });

  it('estado inicial: unsupported si synth ausente', () => {
    const { Ctor } = makeUtteranceCtor();
    const voice = createCoachingVoice({ synth: null, UtteranceCtor: Ctor });
    expect(voice.getState()).toBe('unsupported');
  });

  it('play cancela cualquier utterance previo y arranca uno nuevo', () => {
    const synth = makeSynthMock();
    const { Ctor, created } = makeUtteranceCtor();
    const voice = createCoachingVoice({ synth, UtteranceCtor: Ctor });
    voice.play('Anticipa frenadas, mantén distancia.');

    expect(synth.cancel).toHaveBeenCalledTimes(1);
    expect(synth.speak).toHaveBeenCalledTimes(1);
    expect(created).toHaveLength(1);
    expect(created[0]?.text).toBe('Anticipa frenadas, mantén distancia.');
    expect(created[0]?.rate).toBe(0.95);
    expect(created[0]?.lang).toBe('es-CL');
    expect(created[0]?.voice?.lang).toBe('es-CL');
  });

  it('play con texto vacío o whitespace → no-op', () => {
    const synth = makeSynthMock();
    const { Ctor } = makeUtteranceCtor();
    const voice = createCoachingVoice({ synth, UtteranceCtor: Ctor });
    voice.play('');
    voice.play('   \n\t  ');
    expect(synth.speak).not.toHaveBeenCalled();
  });

  it('subscribe es invocado con state actual + cambios', () => {
    const synth = makeSynthMock();
    const { Ctor, created } = makeUtteranceCtor();
    const voice = createCoachingVoice({ synth, UtteranceCtor: Ctor });

    const states: string[] = [];
    voice.subscribe((s) => states.push(s));
    expect(states).toEqual(['idle']);

    voice.play('hola');
    // simulamos onstart del browser
    created[0]?.onstart?.();
    expect(states).toContain('speaking');

    // simulamos onend
    created[0]?.onend?.();
    expect(states[states.length - 1]).toBe('idle');
  });

  it('onerror con canceled/interrupted no marca error', () => {
    const synth = makeSynthMock();
    const { Ctor, created } = makeUtteranceCtor();
    const voice = createCoachingVoice({ synth, UtteranceCtor: Ctor });
    voice.play('hola');
    created[0]?.onstart?.();
    expect(voice.getState()).toBe('speaking');

    // Simular cancel-related error → no debería marcar 'error'.
    created[0]?.onerror?.({ error: 'interrupted' });
    expect(voice.getState()).toBe('idle');
  });

  it('onerror con error real marca state=error', () => {
    const synth = makeSynthMock();
    const { Ctor, created } = makeUtteranceCtor();
    const voice = createCoachingVoice({ synth, UtteranceCtor: Ctor });
    voice.play('hola');
    created[0]?.onerror?.({ error: 'synthesis-failed' });
    expect(voice.getState()).toBe('error');
  });

  it('stop cancela y vuelve a idle', () => {
    const synth = makeSynthMock();
    const { Ctor, created } = makeUtteranceCtor();
    const voice = createCoachingVoice({ synth, UtteranceCtor: Ctor });
    voice.play('hola');
    created[0]?.onstart?.();
    expect(voice.getState()).toBe('speaking');

    voice.stop();
    expect(synth.cancel).toHaveBeenCalledTimes(2); // 1× pre-play + 1× stop
    expect(voice.getState()).toBe('idle');
  });

  it('play en estado unsupported → no-op silencioso', () => {
    const { Ctor, created } = makeUtteranceCtor();
    const voice = createCoachingVoice({ synth: null, UtteranceCtor: Ctor });
    voice.play('hola');
    expect(created).toHaveLength(0);
  });

  it('synth.speak throw → state=error', () => {
    const synth = makeSynthMock();
    (synth.speak as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('boom');
    });
    const { Ctor } = makeUtteranceCtor();
    const voice = createCoachingVoice({ synth, UtteranceCtor: Ctor });
    voice.play('hola');
    expect(voice.getState()).toBe('error');
  });

  it('unsubscribe deja de recibir cambios', () => {
    const synth = makeSynthMock();
    const { Ctor, created } = makeUtteranceCtor();
    const voice = createCoachingVoice({ synth, UtteranceCtor: Ctor });

    const states: string[] = [];
    const unsub = voice.subscribe((s) => states.push(s));
    expect(states).toEqual(['idle']);
    unsub();

    voice.play('hola');
    created[0]?.onstart?.();
    expect(states).toEqual(['idle']); // sin nuevos events post-unsub
  });
});
