import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoppedDetector, StoppedState } from '../../services/stopped-detector.js';
import type { RecognitionState, VoiceCommandController } from '../../services/voice-commands.js';
import { type SdkPorcupine, createWakeWordController } from '../../services/wake-word.js';
import { VoiceCommandButton } from '../voice/VoiceCommandButton.js';
import { WakeWordBanner } from './WakeWordBanner.js';

const apiGetSpy = vi.fn();
vi.mock('../../lib/api-client.js', () => ({
  api: { get: (...args: unknown[]) => apiGetSpy(...args) },
}));

const CONFIG = {
  disponible: true,
  access_key: 'pv-key',
  keyword_url: 'https://cdn.example/oye-booster-cl.ppn',
  model_url: 'https://cdn.example/porcupine_params_es.pv',
  sensibilidad: 0.5,
};

/** SDK de Picovoice falso: el controlador real corre entero, sin WASM. */
function sdkFalso() {
  let detectar: (() => void) | null = null;
  const worker = { release: vi.fn(async () => undefined), terminate: vi.fn() };
  const subscribe = vi.fn(async () => undefined);
  const unsubscribe = vi.fn(async () => undefined);
  const sdk: SdkPorcupine = {
    PorcupineWorker: {
      create: vi.fn(async (_k, _kw, cb) => {
        detectar = () => cb({ index: 0, label: 'oye-booster' });
        return worker;
      }),
    },
    WebVoiceProcessor: { subscribe, unsubscribe },
  };
  return { sdk, subscribe, unsubscribe, worker, detectar: () => detectar?.() };
}

function detectorFalso() {
  const listeners = new Set<(s: StoppedState) => void>();
  let estado: StoppedState = 'unknown';
  const detector: StoppedDetector = {
    getState: () => estado,
    subscribe: (l) => {
      listeners.add(l);
      l(estado);
      return () => listeners.delete(l);
    },
    stop: vi.fn(),
  };
  return {
    detector,
    emitir: (s: StoppedState) => {
      estado = s;
      for (const l of listeners) {
        l(s);
      }
    },
  };
}

function recognizerFalso(): { ctrl: VoiceCommandController; start: ReturnType<typeof vi.fn> } {
  const start = vi.fn();
  const state: RecognitionState = 'idle';
  return {
    start,
    ctrl: {
      start,
      stop: vi.fn(),
      abort: vi.fn(),
      getState: () => state,
      subscribe: (l) => {
        l(state);
        return () => undefined;
      },
      onCommand: () => () => undefined,
      onUnrecognized: () => () => undefined,
    },
  };
}

describe('WakeWordBanner (T10-22)', () => {
  beforeEach(() => {
    apiGetSpy.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('inactivo: no renderiza ni pide la config', () => {
    const { container } = render(<WakeWordBanner activo={false} />);
    expect(container).toBeEmptyDOMElement();
    expect(apiGetSpy).not.toHaveBeenCalled();
  });

  it('flag encendido: carga el controlador real, escucha con el vehículo detenido y "Oye Booster" arranca el botón de voz', async () => {
    apiGetSpy.mockResolvedValue(CONFIG);
    const f = sdkFalso();
    const d = detectorFalso();
    const r = recognizerFalso();
    render(
      <>
        <WakeWordBanner
          activo
          crearController={() =>
            createWakeWordController({ cargarSdk: async () => f.sdk, pausaTrasDeteccionMs: 50 })
          }
          crearDetector={() => d.detector}
        />
        <VoiceCommandButton
          acceptedIntents={new Set(['confirmar_entrega'] as const)}
          onCommand={vi.fn()}
          recognizer={r.ctrl}
        />
      </>,
    );
    expect(apiGetSpy).toHaveBeenCalledWith('/me/wake-word');
    const banner = await screen.findByTestId('wake-word-active-banner');

    // Sin lectura de vehículo detenido: en pausa y sin micrófono.
    await waitFor(() => expect(banner).toHaveAttribute('data-estado', 'paused'));
    expect(banner.textContent).toMatch(/en pausa/);
    expect(f.subscribe).not.toHaveBeenCalled();

    act(() => d.emitir('stopped'));
    await waitFor(() => expect(banner).toHaveAttribute('data-estado', 'listening'));
    expect(banner.textContent).toMatch(/Escuchando/);
    expect(f.subscribe).toHaveBeenCalledTimes(1);

    act(() => f.detectar());
    expect(r.start).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(banner).toHaveAttribute('data-estado', 'detected'));

    // El vehículo arranca: suelta el micrófono.
    act(() => d.emitir('moving'));
    await waitFor(() => expect(banner).toHaveAttribute('data-estado', 'paused'));
  });

  it('pestaña oculta → pausa; visible otra vez → escucha', async () => {
    apiGetSpy.mockResolvedValue(CONFIG);
    const f = sdkFalso();
    const d = detectorFalso();
    render(
      <WakeWordBanner
        activo
        crearController={() => createWakeWordController({ cargarSdk: async () => f.sdk })}
        crearDetector={() => d.detector}
      />,
    );
    const banner = await screen.findByTestId('wake-word-active-banner');
    act(() => d.emitir('stopped'));
    await waitFor(() => expect(banner).toHaveAttribute('data-estado', 'listening'));

    const visibilidad = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(banner).toHaveAttribute('data-estado', 'paused'));
    visibilidad.mockReturnValue('visible');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(banner).toHaveAttribute('data-estado', 'listening'));
  });

  it('al desmontar suelta el micrófono y termina el worker', async () => {
    apiGetSpy.mockResolvedValue(CONFIG);
    const f = sdkFalso();
    const d = detectorFalso();
    const { unmount } = render(
      <WakeWordBanner
        activo
        crearController={() => createWakeWordController({ cargarSdk: async () => f.sdk })}
        crearDetector={() => d.detector}
      />,
    );
    const banner = await screen.findByTestId('wake-word-active-banner');
    act(() => d.emitir('stopped'));
    await waitFor(() => expect(banner).toHaveAttribute('data-estado', 'listening'));
    unmount();
    await waitFor(() => expect(f.worker.terminate).toHaveBeenCalledTimes(1));
    expect(f.unsubscribe).toHaveBeenCalled();
    expect(d.detector.stop).toHaveBeenCalled();
  });

  it.each([
    [{ disponible: false, motivo: 'sin_access_key' }],
    [{ disponible: true, access_key: '' }],
  ])('config no disponible o inválida (%o): no carga el SDK y no afirma escuchar', async (body) => {
    apiGetSpy.mockResolvedValue(body);
    const cargarSdk = vi.fn();
    render(
      <WakeWordBanner
        activo
        crearController={() => createWakeWordController({ cargarSdk })}
        crearDetector={() => detectorFalso().detector}
      />,
    );
    const banner = await screen.findByTestId('wake-word-active-banner');
    await waitFor(() => expect(apiGetSpy).toHaveBeenCalled());
    expect(banner).toHaveAttribute('data-estado', 'sin_config');
    expect(banner.textContent).toMatch(/preparando/);
    expect(banner.textContent).not.toMatch(/escuchando/i);
    expect(cargarSdk).not.toHaveBeenCalled();
  });

  it('error de red al pedir la config: queda sin config', async () => {
    apiGetSpy.mockRejectedValue(new Error('offline'));
    render(<WakeWordBanner activo crearDetector={() => detectorFalso().detector} />);
    const banner = await screen.findByTestId('wake-word-active-banner');
    await waitFor(() => expect(apiGetSpy).toHaveBeenCalled());
    expect(banner).toHaveAttribute('data-estado', 'sin_config');
  });

  it('micrófono denegado → mensaje de error, sin "Escuchando"', async () => {
    apiGetSpy.mockResolvedValue(CONFIG);
    const f = sdkFalso();
    f.subscribe.mockRejectedValue(new Error('Permission denied'));
    const d = detectorFalso();
    render(
      <WakeWordBanner
        activo
        crearController={() => createWakeWordController({ cargarSdk: async () => f.sdk })}
        crearDetector={() => d.detector}
      />,
    );
    const banner = await screen.findByTestId('wake-word-active-banner');
    act(() => d.emitir('stopped'));
    await waitFor(() => expect(banner).toHaveAttribute('data-estado', 'error'));
    expect(banner.textContent).toMatch(/permiso del micrófono/);
  });

  it('sin WebAssembly → no disponible en este navegador', async () => {
    apiGetSpy.mockResolvedValue(CONFIG);
    render(
      <WakeWordBanner
        activo
        crearController={() =>
          createWakeWordController({ cargarSdk: vi.fn(), soportaWasm: () => false })
        }
        crearDetector={() => detectorFalso().detector}
      />,
    );
    const banner = await screen.findByTestId('wake-word-active-banner');
    await waitFor(() => expect(banner).toHaveAttribute('data-estado', 'unavailable'));
    expect(banner.textContent).toMatch(/no está disponible/);
  });
});
