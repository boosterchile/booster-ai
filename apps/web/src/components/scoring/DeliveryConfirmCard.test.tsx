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
import { DeliveryConfirmCard } from './DeliveryConfirmCard.js';

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

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DeliveryConfirmCard', () => {
  it('estado inicial idle: pregunta + botón "Sí, ya entregué" + voice button', () => {
    const Wrapper = makeWrapper();
    const r = makeRecognizer();
    render(
      <Wrapper>
        <DeliveryConfirmCard assignmentId="a1" recognizer={r.ctrl} />
      </Wrapper>,
    );
    expect(screen.getByText(/¿ya entregaste la carga\?/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sí, ya entregué/i })).toBeInTheDocument();
    expect(screen.getByTestId('voice-command-button')).toBeInTheDocument();
  });

  it('click "Sí" → estado confirming + botón "Confirmar entrega"', () => {
    const Wrapper = makeWrapper();
    const r = makeRecognizer();
    render(
      <Wrapper>
        <DeliveryConfirmCard assignmentId="a1" recognizer={r.ctrl} />
      </Wrapper>,
    );
    fireEvent.click(screen.getByRole('button', { name: /sí, ya entregué/i }));
    expect(screen.getByRole('button', { name: /confirmar entrega/i })).toBeInTheDocument();
    expect(screen.getByText(/confirma diciendo "entregado" otra vez/i)).toBeInTheDocument();
  });

  it('confirming → ratify dispara mutation', async () => {
    const patchSpy = vi.spyOn(api, 'patch').mockResolvedValue({
      ok: true,
      already_delivered: false,
      delivered_at: '2026-05-10T15:30:00Z',
    });
    const Wrapper = makeWrapper();
    const r = makeRecognizer();
    const onConfirmed = vi.fn();
    render(
      <Wrapper>
        <DeliveryConfirmCard assignmentId="a-77" recognizer={r.ctrl} onConfirmed={onConfirmed} />
      </Wrapper>,
    );
    fireEvent.click(screen.getByRole('button', { name: /sí, ya entregué/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirmar entrega/i }));

    await waitFor(() =>
      expect(patchSpy).toHaveBeenCalledWith('/assignments/a-77/confirmar-entrega'),
    );
    await waitFor(() => expect(onConfirmed).toHaveBeenCalled());
    expect(screen.getByText(/entrega confirmada/i)).toBeInTheDocument();
  });

  it('cancel en confirming → vuelve a idle', () => {
    const Wrapper = makeWrapper();
    const r = makeRecognizer();
    render(
      <Wrapper>
        <DeliveryConfirmCard assignmentId="a1" recognizer={r.ctrl} />
      </Wrapper>,
    );
    fireEvent.click(screen.getByRole('button', { name: /sí, ya entregué/i }));
    fireEvent.click(screen.getByRole('button', { name: /cancelar \(volver atrás\)/i }));
    expect(screen.getByRole('button', { name: /sí, ya entregué/i })).toBeInTheDocument();
  });

  it('confirming auto-cancel tras 4s sin acción', () => {
    vi.useFakeTimers();
    try {
      const Wrapper = makeWrapper();
      const r = makeRecognizer();
      render(
        <Wrapper>
          <DeliveryConfirmCard assignmentId="a1" recognizer={r.ctrl} />
        </Wrapper>,
      );
      fireEvent.click(screen.getByRole('button', { name: /sí, ya entregué/i }));
      expect(screen.getByRole('button', { name: /confirmar entrega/i })).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(screen.queryByRole('button', { name: /confirmar entrega/i })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /sí, ya entregué/i })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('voz primer "entregado" → confirming', () => {
    const Wrapper = makeWrapper();
    const r = makeRecognizer();
    render(
      <Wrapper>
        <DeliveryConfirmCard assignmentId="a1" recognizer={r.ctrl} />
      </Wrapper>,
    );
    act(() => {
      r.emitCommand({ intent: 'confirmar_entrega', transcript: 'entregado', confidence: 1 });
    });
    expect(screen.getByRole('button', { name: /confirmar entrega/i })).toBeInTheDocument();
  });

  it('voz segundo "entregado" en confirming → ratify', async () => {
    const patchSpy = vi.spyOn(api, 'patch').mockResolvedValue({
      ok: true,
      already_delivered: false,
      delivered_at: '2026-05-10T15:30:00Z',
    });
    const Wrapper = makeWrapper();
    const r = makeRecognizer();
    render(
      <Wrapper>
        <DeliveryConfirmCard assignmentId="a-9" recognizer={r.ctrl} />
      </Wrapper>,
    );
    act(() => {
      r.emitCommand({ intent: 'confirmar_entrega', transcript: 'entregado', confidence: 1 });
    });
    act(() => {
      r.emitCommand({ intent: 'confirmar_entrega', transcript: 'entregado', confidence: 1 });
    });
    await waitFor(() => expect(patchSpy).toHaveBeenCalled());
  });

  it('voz "cancelar" en confirming → vuelve a idle', () => {
    const Wrapper = makeWrapper();
    const r = makeRecognizer();
    render(
      <Wrapper>
        <DeliveryConfirmCard assignmentId="a1" recognizer={r.ctrl} />
      </Wrapper>,
    );
    fireEvent.click(screen.getByRole('button', { name: /sí, ya entregué/i }));
    expect(screen.getByRole('button', { name: /confirmar entrega/i })).toBeInTheDocument();

    act(() => {
      r.emitCommand({ intent: 'cancelar', transcript: 'cancelar', confidence: 1 });
    });
    expect(screen.queryByRole('button', { name: /confirmar entrega/i })).not.toBeInTheDocument();
  });

  it('error invalid_status → muestra mensaje específico + botón reintentar', async () => {
    vi.spyOn(api, 'patch').mockRejectedValue(
      new ApiError(409, 'invalid_status', {
        code: 'invalid_status',
        current_status: 'cancelado',
      }),
    );
    const Wrapper = makeWrapper();
    const r = makeRecognizer();
    render(
      <Wrapper>
        <DeliveryConfirmCard assignmentId="a1" recognizer={r.ctrl} />
      </Wrapper>,
    );
    fireEvent.click(screen.getByRole('button', { name: /sí, ya entregué/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirmar entrega/i }));
    await waitFor(() =>
      expect(screen.getByText(/este viaje está en estado "cancelado"/i)).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: /reintentar/i })).toBeInTheDocument();
  });

  it('error forbidden_owner_mismatch → mensaje específico', async () => {
    vi.spyOn(api, 'patch').mockRejectedValue(
      new ApiError(403, 'forbidden_owner_mismatch', { code: 'forbidden_owner_mismatch' }),
    );
    const Wrapper = makeWrapper();
    const r = makeRecognizer();
    render(
      <Wrapper>
        <DeliveryConfirmCard assignmentId="a1" recognizer={r.ctrl} />
      </Wrapper>,
    );
    fireEvent.click(screen.getByRole('button', { name: /sí, ya entregué/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirmar entrega/i }));
    await waitFor(() =>
      expect(screen.getByText(/no tienes permisos para confirmar/i)).toBeInTheDocument(),
    );
  });

  it('error de red (no ApiError) → mensaje genérico', async () => {
    vi.spyOn(api, 'patch').mockRejectedValue(new Error('network down'));
    const Wrapper = makeWrapper();
    const r = makeRecognizer();
    render(
      <Wrapper>
        <DeliveryConfirmCard assignmentId="a1" recognizer={r.ctrl} />
      </Wrapper>,
    );
    fireEvent.click(screen.getByRole('button', { name: /sí, ya entregué/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirmar entrega/i }));
    await waitFor(() => expect(screen.getByText(/sin conexión/i)).toBeInTheDocument());
  });

  it('voz "entregado" en idle, sin segundo comando → auto-cancel tras 4s, sin disparar mutation', () => {
    vi.useFakeTimers();
    try {
      const patchSpy = vi.spyOn(api, 'patch');
      const Wrapper = makeWrapper();
      const r = makeRecognizer();
      render(
        <Wrapper>
          <DeliveryConfirmCard assignmentId="a1" recognizer={r.ctrl} />
        </Wrapper>,
      );
      act(() => {
        r.emitCommand({ intent: 'confirmar_entrega', transcript: 'entregado', confidence: 1 });
      });
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(patchSpy).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: /sí, ya entregué/i })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
