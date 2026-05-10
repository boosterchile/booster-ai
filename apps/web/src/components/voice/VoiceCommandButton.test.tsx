import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  RecognitionState,
  RecognizedCommand,
  VoiceCommandController,
} from '../../services/voice-commands.js';
import { VoiceCommandButton } from './VoiceCommandButton.js';

/**
 * Stub VoiceCommandController con state observable.
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

const ALL_INTENTS = new Set([
  'confirmar_entrega',
  'aceptar_oferta',
  'cancelar',
  'repetir',
  'marcar_incidente',
] as const);

describe('VoiceCommandButton', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renderiza botón Hablar en idle', () => {
    const r = makeRecognizer('idle');
    render(
      <VoiceCommandButton acceptedIntents={ALL_INTENTS} onCommand={vi.fn()} recognizer={r.ctrl} />,
    );
    expect(screen.getByRole('button', { name: /activar comando por voz/i })).toBeInTheDocument();
    expect(screen.getByText(/^Hablar$/)).toBeInTheDocument();
  });

  it('click idle → recognizer.start', () => {
    const r = makeRecognizer('idle');
    render(
      <VoiceCommandButton acceptedIntents={ALL_INTENTS} onCommand={vi.fn()} recognizer={r.ctrl} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /activar comando por voz/i }));
    expect(r.spies.start).toHaveBeenCalled();
  });

  it('click listening → recognizer.stop', () => {
    const r = makeRecognizer('idle');
    render(
      <VoiceCommandButton acceptedIntents={ALL_INTENTS} onCommand={vi.fn()} recognizer={r.ctrl} />,
    );
    act(() => {
      r.emit('listening');
    });
    fireEvent.click(screen.getByRole('button', { name: /detener escucha/i }));
    expect(r.spies.stop).toHaveBeenCalled();
  });

  it('listening: aria-pressed=true + label "Detener"', () => {
    const r = makeRecognizer('idle');
    render(
      <VoiceCommandButton acceptedIntents={ALL_INTENTS} onCommand={vi.fn()} recognizer={r.ctrl} />,
    );
    act(() => {
      r.emit('listening');
    });
    const btn = screen.getByRole('button', { name: /detener escucha/i });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/^Detener$/)).toBeInTheDocument();
  });

  it('processing: button disabled + label "Procesando…"', () => {
    const r = makeRecognizer('idle');
    render(
      <VoiceCommandButton acceptedIntents={ALL_INTENTS} onCommand={vi.fn()} recognizer={r.ctrl} />,
    );
    act(() => {
      r.emit('processing');
    });
    expect(screen.getByText(/procesando/i)).toBeInTheDocument();
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('error: muestra hint "Activa el micrófono"', () => {
    const r = makeRecognizer('idle');
    render(
      <VoiceCommandButton acceptedIntents={ALL_INTENTS} onCommand={vi.fn()} recognizer={r.ctrl} />,
    );
    act(() => {
      r.emit('error');
    });
    expect(screen.getByText(/activa el micrófono/i)).toBeInTheDocument();
  });

  it('unsupported: componente se oculta', () => {
    const r = makeRecognizer('unsupported');
    render(
      <VoiceCommandButton acceptedIntents={ALL_INTENTS} onCommand={vi.fn()} recognizer={r.ctrl} />,
    );
    expect(screen.queryByTestId('voice-command-button')).not.toBeInTheDocument();
  });

  it('comando intent aceptado → onCommand', () => {
    const r = makeRecognizer('idle');
    const onCommand = vi.fn();
    render(
      <VoiceCommandButton
        acceptedIntents={new Set(['confirmar_entrega'])}
        onCommand={onCommand}
        recognizer={r.ctrl}
      />,
    );
    act(() => {
      r.emitCommand({ intent: 'confirmar_entrega', transcript: 'entregado', confidence: 1 });
    });
    expect(onCommand).toHaveBeenCalledWith(
      expect.objectContaining({ intent: 'confirmar_entrega' }),
    );
  });

  it('comando fuera del set → onUnknown si se pasa', () => {
    const r = makeRecognizer('idle');
    const onCommand = vi.fn();
    const onUnknown = vi.fn();
    render(
      <VoiceCommandButton
        acceptedIntents={new Set(['confirmar_entrega'])}
        onCommand={onCommand}
        onUnknown={onUnknown}
        recognizer={r.ctrl}
      />,
    );
    act(() => {
      r.emitCommand({ intent: 'aceptar_oferta', transcript: 'tomo oferta', confidence: 1 });
    });
    expect(onCommand).not.toHaveBeenCalled();
    expect(onUnknown).toHaveBeenCalled();
  });

  it('unrecognized: muestra hint "No entendí …"', () => {
    const r = makeRecognizer('idle');
    render(
      <VoiceCommandButton acceptedIntents={ALL_INTENTS} onCommand={vi.fn()} recognizer={r.ctrl} />,
    );
    act(() => {
      r.emitUnrecognized('cómo está el tiempo');
    });
    expect(screen.getByTestId('voice-unrecognized-hint')).toHaveTextContent(
      /no entendí "cómo está el tiempo"/i,
    );
  });

  it('idleLabel custom', () => {
    const r = makeRecognizer('idle');
    render(
      <VoiceCommandButton
        acceptedIntents={ALL_INTENTS}
        onCommand={vi.fn()}
        recognizer={r.ctrl}
        idleLabel="Toca y di entregado"
      />,
    );
    expect(screen.getByText('Toca y di entregado')).toBeInTheDocument();
  });
});
