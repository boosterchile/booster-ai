import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../../lib/api-client.js';
import type {
  RecognitionState,
  RecognizedCommand,
  VoiceCommandController,
} from '../../services/voice-commands.js';
import { VoiceAcceptOfferControl } from './VoiceAcceptOfferControl.js';

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function makeRecognizer(initial: RecognitionState = 'idle') {
  let state: RecognitionState = initial;
  const stateListeners = new Set<(s: RecognitionState) => void>();
  const cmdListeners = new Set<(c: RecognizedCommand) => void>();
  const ctrl: VoiceCommandController = {
    start: vi.fn(),
    stop: vi.fn(),
    abort: vi.fn(),
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
    onUnrecognized: () => () => undefined,
  };
  return {
    ctrl,
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
  };
}

const OFFER_ID = 'o-1';
const TRACKING_CODE = 'BOO-XYZ987';

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('VoiceAcceptOfferControl', () => {
  it('renderiza idle: hint con tracking code + voice button + nota single-offer', () => {
    const Wrapper = makeWrapper();
    const r = makeRecognizer();
    render(
      <Wrapper>
        <VoiceAcceptOfferControl
          offerId={OFFER_ID}
          trackingCode={TRACKING_CODE}
          recognizer={r.ctrl}
        />
      </Wrapper>,
    );
    expect(screen.getByText(/aceptar por voz/i)).toBeInTheDocument();
    expect(screen.getByText(/solo aparece cuando hay una sola oferta/i)).toBeInTheDocument();
    expect(screen.getByTestId('voice-command-button')).toBeInTheDocument();
  });

  it('voz 1ra "aceptar oferta" → confirming + botón verde con tracking_code', () => {
    const Wrapper = makeWrapper();
    const r = makeRecognizer();
    render(
      <Wrapper>
        <VoiceAcceptOfferControl
          offerId={OFFER_ID}
          trackingCode={TRACKING_CODE}
          recognizer={r.ctrl}
        />
      </Wrapper>,
    );
    act(() => {
      r.emitCommand({ intent: 'aceptar_oferta', transcript: 'aceptar oferta', confidence: 1 });
    });
    expect(screen.getByText(/confirma diciendo "aceptar" otra vez/i)).toBeInTheDocument();
    expect(screen.getByTestId('voice-accept-confirm')).toHaveTextContent(new RegExp(TRACKING_CODE));
  });

  it('voz 2da "aceptar" en confirming → POST /offers/:id/accept', async () => {
    const postSpy = vi.spyOn(api, 'post').mockResolvedValue({});
    const Wrapper = makeWrapper();
    const r = makeRecognizer();
    const onAccepted = vi.fn();
    render(
      <Wrapper>
        <VoiceAcceptOfferControl
          offerId={OFFER_ID}
          trackingCode={TRACKING_CODE}
          recognizer={r.ctrl}
          onAccepted={onAccepted}
        />
      </Wrapper>,
    );
    act(() => {
      r.emitCommand({ intent: 'aceptar_oferta', transcript: 'aceptar oferta', confidence: 1 });
    });
    act(() => {
      r.emitCommand({ intent: 'aceptar_oferta', transcript: 'aceptar', confidence: 1 });
    });
    await waitFor(() => expect(postSpy).toHaveBeenCalledWith('/offers/o-1/accept', {}));
    await waitFor(() => expect(onAccepted).toHaveBeenCalled());
    expect(screen.getByTestId('voice-accept-success')).toBeInTheDocument();
  });

  it('click visual "Confirmar aceptación" → POST', async () => {
    const postSpy = vi.spyOn(api, 'post').mockResolvedValue({});
    const Wrapper = makeWrapper();
    const r = makeRecognizer();
    render(
      <Wrapper>
        <VoiceAcceptOfferControl
          offerId={OFFER_ID}
          trackingCode={TRACKING_CODE}
          recognizer={r.ctrl}
        />
      </Wrapper>,
    );
    act(() => {
      r.emitCommand({ intent: 'aceptar_oferta', transcript: 'aceptar oferta', confidence: 1 });
    });
    fireEvent.click(screen.getByTestId('voice-accept-confirm'));
    await waitFor(() => expect(postSpy).toHaveBeenCalledWith('/offers/o-1/accept', {}));
  });

  it('voz "cancelar" en confirming → vuelve a idle', () => {
    const Wrapper = makeWrapper();
    const r = makeRecognizer();
    render(
      <Wrapper>
        <VoiceAcceptOfferControl
          offerId={OFFER_ID}
          trackingCode={TRACKING_CODE}
          recognizer={r.ctrl}
        />
      </Wrapper>,
    );
    act(() => {
      r.emitCommand({ intent: 'aceptar_oferta', transcript: 'aceptar oferta', confidence: 1 });
    });
    expect(screen.queryByTestId('voice-accept-confirm')).toBeInTheDocument();

    act(() => {
      r.emitCommand({ intent: 'cancelar', transcript: 'cancelar', confidence: 1 });
    });
    expect(screen.queryByTestId('voice-accept-confirm')).not.toBeInTheDocument();
    expect(screen.getByText(/solo aparece cuando hay una sola oferta/i)).toBeInTheDocument();
  });

  it('auto-cancel tras 4s en confirming sin ratificar', () => {
    vi.useFakeTimers();
    try {
      const Wrapper = makeWrapper();
      const r = makeRecognizer();
      render(
        <Wrapper>
          <VoiceAcceptOfferControl
            offerId={OFFER_ID}
            trackingCode={TRACKING_CODE}
            recognizer={r.ctrl}
          />
        </Wrapper>,
      );
      act(() => {
        r.emitCommand({ intent: 'aceptar_oferta', transcript: 'aceptar oferta', confidence: 1 });
      });
      expect(screen.queryByTestId('voice-accept-confirm')).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(screen.queryByTestId('voice-accept-confirm')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('error 409 (oferta ya no disponible) → mensaje específico', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(
      new ApiError(409, 'offer_not_pending', { code: 'offer_not_pending' }),
    );
    const Wrapper = makeWrapper();
    const r = makeRecognizer();
    render(
      <Wrapper>
        <VoiceAcceptOfferControl
          offerId={OFFER_ID}
          trackingCode={TRACKING_CODE}
          recognizer={r.ctrl}
        />
      </Wrapper>,
    );
    act(() => {
      r.emitCommand({ intent: 'aceptar_oferta', transcript: 'aceptar oferta', confidence: 1 });
    });
    fireEvent.click(screen.getByTestId('voice-accept-confirm'));
    await waitFor(() => expect(screen.getByText(/ya no está disponible/i)).toBeInTheDocument());
  });

  it('error 410 (expirada) → mensaje específico', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(
      new ApiError(410, 'offer_expired', { code: 'offer_expired' }),
    );
    const Wrapper = makeWrapper();
    const r = makeRecognizer();
    render(
      <Wrapper>
        <VoiceAcceptOfferControl
          offerId={OFFER_ID}
          trackingCode={TRACKING_CODE}
          recognizer={r.ctrl}
        />
      </Wrapper>,
    );
    act(() => {
      r.emitCommand({ intent: 'aceptar_oferta', transcript: 'aceptar oferta', confidence: 1 });
    });
    fireEvent.click(screen.getByTestId('voice-accept-confirm'));
    await waitFor(() => expect(screen.getByText(/la oferta expiró/i)).toBeInTheDocument());
  });

  it('error de red (no ApiError) → mensaje genérico de conexión', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(new Error('network down'));
    const Wrapper = makeWrapper();
    const r = makeRecognizer();
    render(
      <Wrapper>
        <VoiceAcceptOfferControl
          offerId={OFFER_ID}
          trackingCode={TRACKING_CODE}
          recognizer={r.ctrl}
        />
      </Wrapper>,
    );
    act(() => {
      r.emitCommand({ intent: 'aceptar_oferta', transcript: 'aceptar oferta', confidence: 1 });
    });
    fireEvent.click(screen.getByTestId('voice-accept-confirm'));
    await waitFor(() => expect(screen.getByText(/sin conexión/i)).toBeInTheDocument());
  });
});
