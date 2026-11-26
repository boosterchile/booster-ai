import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const get = vi.fn();
vi.mock('../../lib/api-client.js', async (original) => ({
  ...(await original<typeof import('../../lib/api-client.js')>()),
  api: { get: (...a: unknown[]) => get(...a) },
}));

const { HuellaDelMes } = await import('./HuellaDelMes.js');

function renderizar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <HuellaDelMes ahora={new Date('2026-11-26T12:00:00Z')} />
    </QueryClientProvider>,
  );
}

const CERO = { certificados: 0, kgco2e: 0, ahorro_kgco2e: 0 };

describe('HuellaDelMes (.specs/frente2-cierre §3.1)', () => {
  it('el total del mes separado por sello, con el mes en curso', async () => {
    get.mockResolvedValueOnce({
      resumen: {
        certificados: 3,
        por_presentacion: {
          primario: CERO,
          medido_teltonika: { certificados: 2, kgco2e: 120.5, ahorro_kgco2e: 0 },
          estimado: { certificados: 1, kgco2e: 40, ahorro_kgco2e: 0 },
        },
      },
    });
    renderizar();
    const total = await screen.findByTestId('huella-mes-total');
    expect(screen.getByRole('heading', { name: 'Huella noviembre' })).toBeInTheDocument();
    expect(
      [...total.querySelectorAll('[data-cifra-huella]')].map((c) =>
        c.getAttribute('data-presentacion'),
      ),
    ).toEqual(['medido_teltonika', 'estimado']);
    expect(screen.getByText('3 viajes certificados')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/assignments/huella-mes', expect.anything());
  });

  it('sin viajes certificados lo dice, sin cifra', async () => {
    get.mockResolvedValueOnce({
      resumen: {
        certificados: 0,
        por_presentacion: { primario: CERO, medido_teltonika: CERO, estimado: CERO },
      },
    });
    renderizar();
    expect(await screen.findByTestId('huella-mes-total')).toHaveTextContent(
      'Sin viajes certificados este mes',
    );
  });
});
