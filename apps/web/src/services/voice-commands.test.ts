import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type RecognitionState,
  type SpeechRecognitionErrorEventLike,
  type SpeechRecognitionEventLike,
  type SpeechRecognitionLike,
  createVoiceCommandRecognizer,
  parseCommand,
} from './voice-commands.js';

describe('parseCommand', () => {
  // ----- match positivo por intent -----
  it('confirmar_entrega: "ya entregué"', () => {
    expect(parseCommand('Ya entregué la carga')?.intent).toBe('confirmar_entrega');
  });

  it('confirmar_entrega: "entregado"', () => {
    expect(parseCommand('entregado')?.intent).toBe('confirmar_entrega');
  });

  it('confirmar_entrega: "confirmar entrega"', () => {
    expect(parseCommand('confirmar entrega por favor')?.intent).toBe('confirmar_entrega');
  });

  it('confirmar_entrega: tolerante a whitespace ("confirmar  entrega")', () => {
    expect(parseCommand('confirmar    entrega')?.intent).toBe('confirmar_entrega');
  });

  it('marcar_incidente: "incidente"', () => {
    expect(parseCommand('hay un incidente en ruta')?.intent).toBe('marcar_incidente');
  });

  it('marcar_incidente: "tengo un problema"', () => {
    expect(parseCommand('Tengo un problema con el camión')?.intent).toBe('marcar_incidente');
  });

  it('aceptar_oferta: "acepto la oferta"', () => {
    expect(parseCommand('acepto la oferta')?.intent).toBe('aceptar_oferta');
  });

  it('aceptar_oferta: "tomo oferta"', () => {
    expect(parseCommand('Tomo oferta')?.intent).toBe('aceptar_oferta');
  });

  it('cancelar: "cancelar"', () => {
    expect(parseCommand('cancelar')?.intent).toBe('cancelar');
  });

  it('cancelar: "olvídalo"', () => {
    expect(parseCommand('Olvídalo')?.intent).toBe('cancelar');
  });

  it('repetir: "otra vez"', () => {
    expect(parseCommand('otra vez por favor')?.intent).toBe('repetir');
  });

  it('repetir: "repíteme"', () => {
    expect(parseCommand('Repíteme eso')?.intent).toBe('repetir');
  });

  // ----- ambiguity / priority -----
  it('cancelar gana sobre aceptar cuando aparecen los dos ("cancelar la oferta")', () => {
    // Cancelar tiene priority alta porque puede modificar el verbo siguiente.
    expect(parseCommand('cancelar la oferta')?.intent).toBe('cancelar');
  });

  it('case-insensitive', () => {
    expect(parseCommand('ENTREGADO')?.intent).toBe('confirmar_entrega');
    expect(parseCommand('Cancelar')?.intent).toBe('cancelar');
  });

  // ----- no match -----
  it('null si transcript vacío', () => {
    expect(parseCommand('')).toBeNull();
    expect(parseCommand('   ')).toBeNull();
  });

  it('null si no matchea ningún intent', () => {
    expect(parseCommand('hola buen día')).toBeNull();
    expect(parseCommand('cómo está el tránsito')).toBeNull();
  });

  it('NO matchea sub-strings dentro de palabras ("cancelaron")', () => {
    // 'cancelar' debe ser word-boundary; 'cancelaron' no es 'cancelar'.
    expect(parseCommand('me cancelaron el viaje')).toBeNull();
  });

  it('NO matchea "no" como cancelar (demasiado ambiguo)', () => {
    // "no" no está en la lista de tokens — solo cancelar/cancelo/etc.
    expect(parseCommand('no')).toBeNull();
  });

  // ----- shape del resultado -----
  it('preserva confidence si se pasa', () => {
    const cmd = parseCommand('entregado', 0.85);
    expect(cmd?.confidence).toBe(0.85);
  });

  it('default confidence = 1.0 si no se pasa', () => {
    expect(parseCommand('entregado')?.confidence).toBe(1.0);
  });

  it('transcript en el resultado está normalizado a lowercase trimmed', () => {
    const cmd = parseCommand('   ENTREGADO   ');
    expect(cmd?.transcript).toBe('entregado');
  });
});

describe('createVoiceCommandRecognizer', () => {
  /**
   * Stub de SpeechRecognition. Captura últimas invocaciones de
   * start/stop/abort y permite emitir eventos manualmente.
   */
  function makeRecognizerCtor() {
    const instances: Array<MockRecognizer> = [];

    class MockRecognizer implements SpeechRecognitionLike {
      lang = '';
      interimResults = false;
      continuous = false;
      maxAlternatives = 1;
      onresult: ((e: SpeechRecognitionEventLike) => void) | null = null;
      onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null = null;
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onnomatch: (() => void) | null = null;
      startCalls = 0;
      stopCalls = 0;
      abortCalls = 0;
      throwOnStart = false;

      constructor() {
        instances.push(this);
      }
      start() {
        this.startCalls += 1;
        if (this.throwOnStart) {
          throw new DOMException('already started', 'InvalidStateError');
        }
        // Simular onstart asíncrono.
        queueMicrotask(() => this.onstart?.());
      }
      stop() {
        this.stopCalls += 1;
        queueMicrotask(() => this.onend?.());
      }
      abort() {
        this.abortCalls += 1;
        queueMicrotask(() => this.onend?.());
      }

      emitFinalResult(transcript: string, confidence = 1.0) {
        const event: SpeechRecognitionEventLike = {
          resultIndex: 0,
          results: [
            {
              isFinal: true,
              length: 1,
              0: { transcript, confidence },
            },
          ],
        };
        this.onresult?.(event);
      }

      emitError(error: string) {
        this.onerror?.({ error });
      }
    }
    return { Ctor: MockRecognizer, instances };
  }

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('estado inicial: idle si Ctor está disponible', () => {
    const { Ctor } = makeRecognizerCtor();
    const ctrl = createVoiceCommandRecognizer({ RecognitionCtor: Ctor });
    expect(ctrl.getState()).toBe('idle');
  });

  it('estado inicial: unsupported si Ctor=null', () => {
    const ctrl = createVoiceCommandRecognizer({ RecognitionCtor: null });
    expect(ctrl.getState()).toBe('unsupported');
  });

  it('start() invoca recognizer.start y transiciona a listening', async () => {
    const { Ctor, instances } = makeRecognizerCtor();
    const ctrl = createVoiceCommandRecognizer({ RecognitionCtor: Ctor });
    ctrl.start();
    await Promise.resolve(); // flush microtasks
    expect(instances.length).toBe(1);
    expect(instances[0]?.startCalls).toBe(1);
    expect(ctrl.getState()).toBe('listening');
  });

  it('start() en estado listening es no-op (no double-start)', async () => {
    const { Ctor, instances } = makeRecognizerCtor();
    const ctrl = createVoiceCommandRecognizer({ RecognitionCtor: Ctor });
    ctrl.start();
    await Promise.resolve();
    ctrl.start(); // segundo start
    expect(instances[0]?.startCalls).toBe(1);
  });

  it('start() en unsupported es no-op silencioso', () => {
    const ctrl = createVoiceCommandRecognizer({ RecognitionCtor: null });
    ctrl.start();
    expect(ctrl.getState()).toBe('unsupported');
  });

  it('configura lang=es-CL por default', async () => {
    const { Ctor, instances } = makeRecognizerCtor();
    const ctrl = createVoiceCommandRecognizer({ RecognitionCtor: Ctor });
    ctrl.start();
    await Promise.resolve();
    expect(instances[0]?.lang).toBe('es-CL');
  });

  it('lang custom respetada', async () => {
    const { Ctor, instances } = makeRecognizerCtor();
    const ctrl = createVoiceCommandRecognizer({
      RecognitionCtor: Ctor,
      lang: 'es-MX',
    });
    ctrl.start();
    await Promise.resolve();
    expect(instances[0]?.lang).toBe('es-MX');
  });

  it('result final con intent reconocido → onCommand listener', async () => {
    const { Ctor, instances } = makeRecognizerCtor();
    const ctrl = createVoiceCommandRecognizer({ RecognitionCtor: Ctor });
    const cmds: string[] = [];
    ctrl.onCommand((c) => cmds.push(c.intent));
    ctrl.start();
    await Promise.resolve();
    instances[0]?.emitFinalResult('confirmar entrega');
    expect(cmds).toEqual(['confirmar_entrega']);
  });

  it('result final SIN intent matcheable → onUnrecognized listener', async () => {
    const { Ctor, instances } = makeRecognizerCtor();
    const ctrl = createVoiceCommandRecognizer({ RecognitionCtor: Ctor });
    const unrecognized: string[] = [];
    const cmds: string[] = [];
    ctrl.onCommand((c) => cmds.push(c.intent));
    ctrl.onUnrecognized((t) => unrecognized.push(t));
    ctrl.start();
    await Promise.resolve();
    instances[0]?.emitFinalResult('cómo está el tiempo');
    expect(cmds).toEqual([]);
    expect(unrecognized).toEqual(['cómo está el tiempo']);
  });

  it('error not-allowed (mic denegado) → state=error', async () => {
    const { Ctor, instances } = makeRecognizerCtor();
    const ctrl = createVoiceCommandRecognizer({ RecognitionCtor: Ctor });
    ctrl.start();
    await Promise.resolve();
    instances[0]?.emitError('not-allowed');
    expect(ctrl.getState()).toBe('error');
  });

  it('error no-speech / aborted NO marcan error (esperables)', async () => {
    const { Ctor, instances } = makeRecognizerCtor();
    const ctrl = createVoiceCommandRecognizer({ RecognitionCtor: Ctor });
    ctrl.start();
    await Promise.resolve();
    instances[0]?.emitError('no-speech');
    expect(ctrl.getState()).toBe('idle');
  });

  it('start() throws InvalidStateError → state=error', async () => {
    const { Ctor, instances } = makeRecognizerCtor();
    const ctrl = createVoiceCommandRecognizer({ RecognitionCtor: Ctor });
    // Forzar el throw — necesitamos crear la instancia primero.
    ctrl.start();
    await Promise.resolve();
    // Reset al recognizer interno requeriría exponer state. En su lugar
    // simulamos: hacemos abort para volver a idle, marcamos throwOnStart,
    // re-start.
    ctrl.abort();
    if (instances[0]) {
      instances[0].throwOnStart = true;
    }
    ctrl.start();
    expect(ctrl.getState()).toBe('error');
  });

  it('subscribe recibe state actual + cambios', async () => {
    const { Ctor, instances } = makeRecognizerCtor();
    const ctrl = createVoiceCommandRecognizer({ RecognitionCtor: Ctor });
    const states: RecognitionState[] = [];
    ctrl.subscribe((s) => states.push(s));
    expect(states).toEqual(['idle']);
    ctrl.start();
    await Promise.resolve();
    expect(states).toContain('listening');
    instances[0]?.emitFinalResult('entregado');
    expect(states).toContain('processing');
  });

  it('unsubscribe deja de recibir', async () => {
    const { Ctor } = makeRecognizerCtor();
    const ctrl = createVoiceCommandRecognizer({ RecognitionCtor: Ctor });
    const states: RecognitionState[] = [];
    const unsub = ctrl.subscribe((s) => states.push(s));
    expect(states).toEqual(['idle']);
    unsub();
    ctrl.start();
    await Promise.resolve();
    expect(states).toEqual(['idle']); // sin nuevos
  });

  it('abort() llama recognizer.abort', async () => {
    const { Ctor, instances } = makeRecognizerCtor();
    const ctrl = createVoiceCommandRecognizer({ RecognitionCtor: Ctor });
    ctrl.start();
    await Promise.resolve();
    ctrl.abort();
    expect(instances[0]?.abortCalls).toBe(1);
  });

  it('stop() llama recognizer.stop', async () => {
    const { Ctor, instances } = makeRecognizerCtor();
    const ctrl = createVoiceCommandRecognizer({ RecognitionCtor: Ctor });
    ctrl.start();
    await Promise.resolve();
    ctrl.stop();
    expect(instances[0]?.stopCalls).toBe(1);
  });

  it('onCommand unsubscribe deja de recibir', async () => {
    const { Ctor, instances } = makeRecognizerCtor();
    const ctrl = createVoiceCommandRecognizer({ RecognitionCtor: Ctor });
    const cmds: string[] = [];
    const unsub = ctrl.onCommand((c) => cmds.push(c.intent));
    ctrl.start();
    await Promise.resolve();
    instances[0]?.emitFinalResult('entregado');
    expect(cmds).toEqual(['confirmar_entrega']);
    unsub();
    instances[0]?.emitFinalResult('cancelar');
    expect(cmds).toEqual(['confirmar_entrega']); // sin segundo
  });
});
