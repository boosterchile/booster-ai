import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../../lib/api-client.js';
import { BehaviorScoreCard } from './BehaviorScoreCard.js';

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function renderCard(assignmentId = 'a1') {
  const Wrapper = makeWrapper();
  return render(
    <Wrapper>
      <BehaviorScoreCard assignmentId={assignmentId} />
    </Wrapper>,
  );
}

const SCORE_OK = {
  trip_id: 't1',
  score: 87,
  nivel: 'bueno' as const,
  breakdown: {
    aceleracionesBruscas: 1,
    frenadosBruscos: 0,
    curvasBruscas: 1,
    excesosVelocidad: 0,
    penalizacionTotal: 13,
    eventosPorHora: 1.5,
  },
  calculated_at: '2026-05-10T00:00:00Z',
  status: 'disponible' as const,
};

const SCORE_NO_DISP = {
  trip_id: 't1',
  score: null,
  nivel: null,
  breakdown: null,
  status: 'no_disponible' as const,
  reason: 'sin telemetria',
};

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('BehaviorScoreCard — estados', () => {
  it('isLoading → muestra skeleton', () => {
    vi.spyOn(api, 'get').mockImplementation(() => new Promise<never>(() => undefined));
    renderCard();
    expect(screen.getByText(/Cargando score de conducción/)).toBeInTheDocument();
  });

  it('isError → no renderiza nada (silencioso)', async () => {
    // ApiError 401 short-circuita el retry del hook → falla rápido.
    vi.spyOn(api, 'get').mockRejectedValue(new ApiError(401, 'unauthorized', null));
    const { container } = renderCard();
    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
  });

  it('status no_disponible → mensaje educativo Teltonika', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(SCORE_NO_DISP);
    renderCard();
    expect(await screen.findByText(/Score de conducción no disponible/)).toBeInTheDocument();
    expect(screen.getByText(/Activa Teltonika/)).toBeInTheDocument();
  });
});

describe('BehaviorScoreCard — disponible', () => {
  it('muestra score + nivel + eventos/hora colapsado', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(SCORE_OK);
    renderCard();
    expect(await screen.findByText(/87\/100/)).toBeInTheDocument();
    expect(screen.getByText('Bueno')).toBeInTheDocument();
    expect(screen.getByText(/1\.5 eventos\/hora/)).toBeInTheDocument();
    expect(screen.getByText(/2 eventos totales/)).toBeInTheDocument();
  });

  it('eventosPorHora=0 → muestra "Sin eventos"', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      ...SCORE_OK,
      breakdown: {
        ...SCORE_OK.breakdown,
        eventosPorHora: 0,
        aceleracionesBruscas: 0,
        curvasBruscas: 0,
      },
      score: 100,
      nivel: 'excelente',
    });
    renderCard();
    expect(await screen.findByText(/Sin eventos en este viaje/)).toBeInTheDocument();
    expect(screen.getByText('Excelente')).toBeInTheDocument();
  });

  it('expand reveals breakdown + métricas individuales', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(SCORE_OK);
    renderCard();
    const button = await screen.findByRole('button', { expanded: false });
    fireEvent.click(button);
    expect(await screen.findByText('Aceleración brusca')).toBeInTheDocument();
    expect(screen.getByText('Frenado brusco')).toBeInTheDocument();
    expect(screen.getByText('Curva brusca')).toBeInTheDocument();
    expect(screen.getByText('Exceso velocidad')).toBeInTheDocument();
    expect(screen.getByRole('button', { expanded: true })).toBeInTheDocument();
  });

  it('toggle expand/collapse via aria-expanded', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(SCORE_OK);
    renderCard();
    const button = await screen.findByRole('button', { expanded: false });
    fireEvent.click(button);
    expect(screen.getByRole('button', { expanded: true })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { expanded: true }));
    expect(screen.getByRole('button', { expanded: false })).toBeInTheDocument();
  });

  for (const nivel of ['excelente', 'bueno', 'regular', 'malo'] as const) {
    it(`nivel=${nivel} → renderiza badge correspondiente`, async () => {
      vi.spyOn(api, 'get').mockResolvedValue({ ...SCORE_OK, nivel });
      renderCard();
      const labels = {
        excelente: 'Excelente',
        bueno: 'Bueno',
        regular: 'Regular',
        malo: 'Mejorar',
      };
      expect(await screen.findByText(labels[nivel])).toBeInTheDocument();
    });
  }
});

describe('BehaviorScoreCard — coaching IA', () => {
  it('coaching status disponible (gemini) → muestra Sparkles + "Sugerencia personalizada"', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path.includes('/coaching')) {
        return {
          trip_id: 't1',
          message: 'Anticipa los frenados',
          focus: 'frenado',
          source: 'gemini',
          model: 'gemini-pro',
          generated_at: '2026-05-10T00:00:00Z',
          status: 'disponible',
        };
      }
      return SCORE_OK;
    });
    renderCard();
    fireEvent.click(await screen.findByRole('button', { expanded: false }));
    expect(await screen.findByText('Sugerencia personalizada (IA)')).toBeInTheDocument();
    expect(screen.getByText('Anticipa los frenados')).toBeInTheDocument();
  });

  it('coaching source=plantilla → muestra "Sugerencia general"', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path.includes('/coaching')) {
        return {
          trip_id: 't1',
          message: 'Buen viaje',
          focus: 'felicitacion',
          source: 'plantilla',
          model: null,
          generated_at: '2026-05-10T00:00:00Z',
          status: 'disponible',
        };
      }
      return SCORE_OK;
    });
    renderCard();
    fireEvent.click(await screen.findByRole('button', { expanded: false }));
    expect(await screen.findByText('Sugerencia general')).toBeInTheDocument();
  });

  it('coaching no disponible → no se muestra sección', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path.includes('/coaching')) {
        return {
          trip_id: 't1',
          message: null,
          focus: null,
          source: null,
          status: 'no_disponible',
          reason: 'pending',
        };
      }
      return SCORE_OK;
    });
    renderCard();
    fireEvent.click(await screen.findByRole('button', { expanded: false }));
    await screen.findByText('Aceleración brusca');
    expect(screen.queryByText(/Sugerencia/)).not.toBeInTheDocument();
  });
});
