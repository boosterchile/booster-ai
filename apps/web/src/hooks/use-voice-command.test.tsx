import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  RecognitionState,
  RecognizedCommand,
  VoiceCommandController,
} from '../services/voice-commands.js';
import { useVoiceCommand } from './use-voice-command.js';

/**
 * Stub VoiceCommandController con state observable + emisores manuales
 * de comandos / unrecognized.
 */
function makeRecognizer(initial: RecognitionState = 'idle') {
  let state: RecognitionState = initial;
  const stateListeners = new Set<(s: RecognitionState) => void>();
  const cmdListeners = new Set<(c: RecognizedCommand) => void>();
  const unrecListeners = new Set<(t: string) => void>();
  const start = vi.fn();
  const stop = vi.fn();
  const abort = vi.fn();

  const ctrl: VoiceCommandController = {
    start,
    stop,
    abort,
    getState: () => state,
    subscribe: (l) => {
      stateListeners.add(l);
      l(state);
      return () => {
        stateListeners.delete(l);
      };
    },
    onCommand: (l) => {
      cmdListeners.add(l);
      return () => {
        cmdListeners.delete(l);
      };
    },
    onUnrecognized: (l) => {
      unrecListeners.add(l);
      return () => {
        unrecListeners.delete(l);
      };
    },
  };

  return {
    ctrl,
    spies: { start, stop, abort },
    emit: (s: RecognitionState) => {
      state = s;
      for (const l of stateListeners) {
        l(s);
      }
    },
    emitCommand: (cmd: RecognizedCommand) => {
      for (const l of cmdListeners) {
        l(cmd);
      }
    },
    emitUnrecognized: (t: string) => {
      for (const l of unrecListeners) {
        l(t);
      }
    },
  };
}

describe('useVoiceCommand', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('expone state inicial del recognizer', () => {
    const r = makeRecognizer('idle');
    const { result } = renderHook(() => useVoiceCommand({ recognizer: r.ctrl }));
    expect(result.current.state).toBe('idle');
  });

  it('start/stop/abort proxy al recognizer', () => {
    const r = makeRecognizer('idle');
    const { result } = renderHook(() => useVoiceCommand({ recognizer: r.ctrl }));
    result.current.start();
    expect(r.spies.start).toHaveBeenCalled();
    result.current.stop();
    expect(r.spies.stop).toHaveBeenCalled();
    result.current.abort();
    expect(r.spies.abort).toHaveBeenCalled();
  });

  it('estado reactivo al emit del recognizer', async () => {
    const r = makeRecognizer('idle');
    const { result } = renderHook(() => useVoiceCommand({ recognizer: r.ctrl }));
    r.emit('listening');
    await waitFor(() => expect(result.current.state).toBe('listening'));
  });

  it('intent en acceptedIntents → onCommand + auto-stop', () => {
    const r = makeRecognizer('idle');
    const onCommand = vi.fn();
    renderHook(() =>
      useVoiceCommand({
        recognizer: r.ctrl,
        acceptedIntents: new Set(['confirmar_entrega']),
        onCommand,
      }),
    );
    r.emitCommand({ intent: 'confirmar_entrega', transcript: 'entregado', confidence: 0.9 });
    expect(onCommand).toHaveBeenCalledWith(
      expect.objectContaining({ intent: 'confirmar_entrega' }),
    );
    expect(r.spies.stop).toHaveBeenCalled();
  });

  it('intent fuera de acceptedIntents → onUnknown, NO onCommand, NO auto-stop', () => {
    const r = makeRecognizer('idle');
    const onCommand = vi.fn();
    const onUnknown = vi.fn();
    renderHook(() =>
      useVoiceCommand({
        recognizer: r.ctrl,
        acceptedIntents: new Set(['confirmar_entrega']),
        onCommand,
        onUnknown,
      }),
    );
    r.emitCommand({ intent: 'aceptar_oferta', transcript: 'acepto la oferta', confidence: 1 });
    expect(onCommand).not.toHaveBeenCalled();
    expect(onUnknown).toHaveBeenCalled();
    expect(r.spies.stop).not.toHaveBeenCalled();
  });

  it('sin acceptedIntents → onCommand siempre se llama', () => {
    const r = makeRecognizer('idle');
    const onCommand = vi.fn();
    renderHook(() => useVoiceCommand({ recognizer: r.ctrl, onCommand }));
    r.emitCommand({ intent: 'aceptar_oferta', transcript: 'tomo oferta', confidence: 1 });
    r.emitCommand({ intent: 'cancelar', transcript: 'cancelar', confidence: 1 });
    expect(onCommand).toHaveBeenCalledTimes(2);
  });

  it('onUnrecognized → guarda lastUnrecognized + invoca handler', async () => {
    const r = makeRecognizer('idle');
    const onUnrec = vi.fn();
    const { result } = renderHook(() =>
      useVoiceCommand({ recognizer: r.ctrl, onUnrecognized: onUnrec }),
    );
    r.emitUnrecognized('cómo está el tiempo');
    await waitFor(() => expect(result.current.lastUnrecognized).toBe('cómo está el tiempo'));
    expect(onUnrec).toHaveBeenCalledWith('cómo está el tiempo');
  });

  it('handlers son refs vivos — cambiar prop NO re-suscribe', () => {
    const r = makeRecognizer('idle');
    const onCommand1 = vi.fn();
    const onCommand2 = vi.fn();
    const { rerender } = renderHook(
      ({ handler }: { handler: (c: RecognizedCommand) => void }) =>
        useVoiceCommand({
          recognizer: r.ctrl,
          onCommand: handler,
        }),
      { initialProps: { handler: onCommand1 } },
    );

    r.emitCommand({ intent: 'cancelar', transcript: 'cancelar', confidence: 1 });
    expect(onCommand1).toHaveBeenCalledTimes(1);

    rerender({ handler: onCommand2 });
    r.emitCommand({ intent: 'cancelar', transcript: 'cancelar', confidence: 1 });
    expect(onCommand2).toHaveBeenCalledTimes(1);
    expect(onCommand1).toHaveBeenCalledTimes(1); // sin doble call
  });

  it('unmount aborta el recognizer (libera mic)', () => {
    const r = makeRecognizer('idle');
    const { unmount } = renderHook(() => useVoiceCommand({ recognizer: r.ctrl }));
    unmount();
    expect(r.spies.abort).toHaveBeenCalled();
  });
});
