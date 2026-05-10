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
import { IncidentReportCard } from './IncidentReportCard.js';

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function makeRecognizer(initial: RecognitionState = 'idle') {
  const state: RecognitionState = initial;
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

describe('IncidentReportCard', () => {
  it('renderiza idle: botón "Reportar incidente" + voice button', () => {
    const Wrapper = makeWrapper();
    const r = makeRecognizer();
    render(
      <Wrapper>
        <IncidentReportCard assignmentId="a1" recognizer={r.ctrl} />
      </Wrapper>,
    );
    expect(screen.getByTestId('incident-open-button')).toBeInTheDocument();
    expect(screen.getByTestId('voice-command-button')).toBeInTheDocument();
  });

  it('click "Reportar incidente" → panel de selección con 5 botones', () => {
    const Wrapper = makeWrapper();
    const r = makeRecognizer();
    render(
      <Wrapper>
        <IncidentReportCard assignmentId="a1" recognizer={r.ctrl} />
      </Wrapper>,
    );
    fireEvent.click(screen.getByTestId('incident-open-button'));
    expect(screen.getByText(/¿qué tipo de incidente\?/i)).toBeInTheDocument();
    expect(screen.getByTestId('incident-type-accidente')).toBeInTheDocument();
    expect(screen.getByTestId('incident-type-demora')).toBeInTheDocument();
    expect(screen.getByTestId('incident-type-falla_mecanica')).toBeInTheDocument();
    expect(screen.getByTestId('incident-type-problema_carga')).toBeInTheDocument();
    expect(screen.getByTestId('incident-type-otro')).toBeInTheDocument();
  });

  it('click tipo → POST /assignments/:id/incidents + estado success', async () => {
    const postSpy = vi.spyOn(api, 'post').mockResolvedValue({
      ok: true,
      trip_event_id: 'e-1',
      recorded_at: '2026-05-10T18:00:00Z',
    });
    const Wrapper = makeWrapper();
    const r = makeRecognizer();
    render(
      <Wrapper>
        <IncidentReportCard assignmentId="a-77" recognizer={r.ctrl} />
      </Wrapper>,
    );
    fireEvent.click(screen.getByTestId('incident-open-button'));
    fireEvent.click(screen.getByTestId('incident-type-falla_mecanica'));

    await waitFor(() =>
      expect(postSpy).toHaveBeenCalledWith('/assignments/a-77/incidents', {
        incident_type: 'falla_mecanica',
      }),
    );
    await waitFor(() => expect(screen.getByText(/incidente reportado/i)).toBeInTheDocument());
  });

  it('voz "marcar incidente" en idle → abre panel', () => {
    const Wrapper = makeWrapper();
    const r = makeRecognizer();
    render(
      <Wrapper>
        <IncidentReportCard assignmentId="a1" recognizer={r.ctrl} />
      </Wrapper>,
    );
    act(() => {
      r.emitCommand({ intent: 'marcar_incidente', transcript: 'incidente', confidence: 1 });
    });
    expect(screen.getByText(/¿qué tipo de incidente\?/i)).toBeInTheDocument();
  });

  it('voz "cancelar" en panel → cierra panel', () => {
    const Wrapper = makeWrapper();
    const r = makeRecognizer();
    render(
      <Wrapper>
        <IncidentReportCard assignmentId="a1" recognizer={r.ctrl} />
      </Wrapper>,
    );
    fireEvent.click(screen.getByTestId('incident-open-button'));
    expect(screen.getByText(/¿qué tipo de incidente\?/i)).toBeInTheDocument();

    act(() => {
      r.emitCommand({ intent: 'cancelar', transcript: 'cancelar', confidence: 1 });
    });
    expect(screen.queryByText(/¿qué tipo de incidente\?/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('incident-open-button')).toBeInTheDocument();
  });

  it('botón X cierra panel', () => {
    const Wrapper = makeWrapper();
    const r = makeRecognizer();
    render(
      <Wrapper>
        <IncidentReportCard assignmentId="a1" recognizer={r.ctrl} />
      </Wrapper>,
    );
    fireEvent.click(screen.getByTestId('incident-open-button'));
    fireEvent.click(screen.getByLabelText(/^cancelar$/i));
    expect(screen.queryByText(/¿qué tipo de incidente\?/i)).not.toBeInTheDocument();
  });

  it('error 403 → mensaje específico "no permisos"', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(
      new ApiError(403, 'forbidden_owner_mismatch', { code: 'forbidden_owner_mismatch' }),
    );
    const Wrapper = makeWrapper();
    const r = makeRecognizer();
    render(
      <Wrapper>
        <IncidentReportCard assignmentId="a1" recognizer={r.ctrl} />
      </Wrapper>,
    );
    fireEvent.click(screen.getByTestId('incident-open-button'));
    fireEvent.click(screen.getByTestId('incident-type-accidente'));
    await waitFor(() =>
      expect(screen.getByTestId('incident-error')).toHaveTextContent(/no tienes permisos/i),
    );
  });

  it('error 404 → mensaje específico "viaje no encontrado"', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(
      new ApiError(404, 'assignment_not_found', { code: 'assignment_not_found' }),
    );
    const Wrapper = makeWrapper();
    const r = makeRecognizer();
    render(
      <Wrapper>
        <IncidentReportCard assignmentId="a1" recognizer={r.ctrl} />
      </Wrapper>,
    );
    fireEvent.click(screen.getByTestId('incident-open-button'));
    fireEvent.click(screen.getByTestId('incident-type-accidente'));
    await waitFor(() =>
      expect(screen.getByTestId('incident-error')).toHaveTextContent(/no se encontró el viaje/i),
    );
  });

  it('error de red (no ApiError) → mensaje "sin conexión"', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(new Error('network down'));
    const Wrapper = makeWrapper();
    const r = makeRecognizer();
    render(
      <Wrapper>
        <IncidentReportCard assignmentId="a1" recognizer={r.ctrl} />
      </Wrapper>,
    );
    fireEvent.click(screen.getByTestId('incident-open-button'));
    fireEvent.click(screen.getByTestId('incident-type-otro'));
    await waitFor(() =>
      expect(screen.getByTestId('incident-error')).toHaveTextContent(/sin conexión/i),
    );
  });
});
