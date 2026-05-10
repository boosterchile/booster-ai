import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoachingVoiceController, VoiceState } from '../../services/coaching-voice.js';
import { CoachingVoicePlayer } from './CoachingVoicePlayer.js';

/**
 * Stub controller: state observable + spies en play/stop.
 */
function makeController(initial: VoiceState = 'idle'): CoachingVoiceController & {
  spies: { play: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> };
  emit: (s: VoiceState) => void;
} {
  let state: VoiceState = initial;
  const listeners = new Set<(s: VoiceState) => void>();
  const play = vi.fn((_text: string) => undefined);
  const stop = vi.fn();
  return {
    play,
    stop,
    getState: () => state,
    subscribe: (l) => {
      listeners.add(l);
      l(state);
      return () => {
        listeners.delete(l);
      };
    },
    emit: (s: VoiceState) => {
      state = s;
      for (const l of listeners) {
        l(s);
      }
    },
    spies: { play, stop },
  };
}

describe('CoachingVoicePlayer', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renderiza botón Escuchar en estado idle', () => {
    const ctrl = makeController('idle');
    render(<CoachingVoicePlayer message="hola" controller={ctrl} />);
    const btn = screen.getByRole('button', { name: /escuchar coaching/i });
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute('aria-pressed', 'false');
  });

  it('click → llama controller.play con el message', () => {
    const ctrl = makeController('idle');
    render(<CoachingVoicePlayer message="Anticipa frenadas." controller={ctrl} />);
    fireEvent.click(screen.getByRole('button', { name: /escuchar coaching/i }));
    expect(ctrl.spies.play).toHaveBeenCalledWith('Anticipa frenadas.');
  });

  it('cambia a Detener cuando state=speaking', () => {
    const ctrl = makeController('idle');
    render(<CoachingVoicePlayer message="hola" controller={ctrl} />);
    act(() => {
      ctrl.emit('speaking');
    });
    const btn = screen.getByRole('button', { name: /detener reproducción/i });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
  });

  it('click en Detener → controller.stop', () => {
    const ctrl = makeController('idle');
    render(<CoachingVoicePlayer message="hola" controller={ctrl} />);
    act(() => {
      ctrl.emit('speaking');
    });
    fireEvent.click(screen.getByRole('button', { name: /detener reproducción/i }));
    expect(ctrl.spies.stop).toHaveBeenCalledTimes(1);
  });

  it('state=unsupported → componente se oculta', () => {
    const ctrl = makeController('unsupported');
    render(<CoachingVoicePlayer message="hola" controller={ctrl} />);
    expect(screen.queryByTestId('coaching-voice-player')).not.toBeInTheDocument();
  });

  it('state=error → muestra mensaje degradado', () => {
    const ctrl = makeController('idle');
    render(<CoachingVoicePlayer message="hola" controller={ctrl} />);
    act(() => {
      ctrl.emit('error');
    });
    expect(screen.getByText(/no se pudo reproducir el audio/i)).toBeInTheDocument();
  });

  it('checkbox auto-play default OFF cuando localStorage vacío', () => {
    const ctrl = makeController('idle');
    render(<CoachingVoicePlayer message="hola" controller={ctrl} />);
    const checkbox = screen.getByRole('checkbox', {
      name: /reproducir automáticamente al terminar viajes/i,
    });
    expect(checkbox).not.toBeChecked();
  });

  it('toggle checkbox → persiste en localStorage', () => {
    const ctrl = makeController('idle');
    render(<CoachingVoicePlayer message="hola" controller={ctrl} />);
    const checkbox = screen.getByRole('checkbox', {
      name: /reproducir automáticamente al terminar viajes/i,
    });
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
    expect(window.localStorage.getItem('booster:coaching-voice:autoplay-enabled')).toBe('1');

    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();
    expect(window.localStorage.getItem('booster:coaching-voice:autoplay-enabled')).toBeNull();
  });

  it('auto-play opt-in: arranca al montar si localStorage flag está', () => {
    window.localStorage.setItem('booster:coaching-voice:autoplay-enabled', '1');
    const ctrl = makeController('idle');
    render(<CoachingVoicePlayer message="Mantén distancia." controller={ctrl} />);
    expect(ctrl.spies.play).toHaveBeenCalledWith('Mantén distancia.');
  });

  it('auto-play OFF: NO arranca al montar', () => {
    const ctrl = makeController('idle');
    render(<CoachingVoicePlayer message="Mantén distancia." controller={ctrl} />);
    expect(ctrl.spies.play).not.toHaveBeenCalled();
  });

  it('auto-play con message vacío: NO arranca (defensivo)', () => {
    window.localStorage.setItem('booster:coaching-voice:autoplay-enabled', '1');
    const ctrl = makeController('idle');
    render(<CoachingVoicePlayer message="   " controller={ctrl} />);
    expect(ctrl.spies.play).not.toHaveBeenCalled();
  });

  it('aria-live region anuncia speaking a screen readers', () => {
    const ctrl = makeController('idle');
    const { container } = render(<CoachingVoicePlayer message="hola" controller={ctrl} />);
    act(() => {
      ctrl.emit('speaking');
    });
    const live = container.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toMatch(/reproduciendo coaching/i);
  });
});
