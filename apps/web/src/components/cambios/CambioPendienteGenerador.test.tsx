import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../../lib/api-client.js';
import { CambioPendienteGenerador } from './CambioPendienteGenerador.js';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const CAMBIO = {
  id: 'sol-1',
  cambios: { proposed_price_clp: 900_000 },
  valores_anteriores: { proposed_price_clp: 800_000 },
  creado_en: '2026-11-09T15:00:00.000Z',
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('CambioPendienteGenerador', () => {
  it('muestra el diff y, con desglose, el total a pagar', () => {
    render(
      <CambioPendienteGenerador
        tripId="t-1"
        cambio={{
          ...CAMBIO,
          desglose_propuesto: {
            precio_transportista_clp: 900_000,
            comision_pct: 8,
            comision_clp: 72_000,
            iva_comision_clp: 13_680,
            precio_generador_clp: 972_000,
            total_factura_generador_clp: 85_680,
          },
        }}
        puedeRetirar
      />,
      { wrapper },
    );
    expect(
      screen.getByText('Cambio pendiente de aprobación del transportista'),
    ).toBeInTheDocument();
    expect(screen.getAllByText('$900.000').length).toBeGreaterThan(0);
    expect(screen.getByText('Total a pagar')).toBeInTheDocument();
  });

  it('retira la solicitud', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ ok: true });
    render(<CambioPendienteGenerador tripId="t-1" cambio={CAMBIO} puedeRetirar />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Retirar solicitud' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        '/trip-requests-v2/t-1/solicitudes-cambio/sol-1/retirar',
        {},
      ),
    );
  });

  it('si el transportista ya respondió, lo explica', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(409, 'solicitud_no_vigente', null));
    render(<CambioPendienteGenerador tripId="t-1" cambio={CAMBIO} puedeRetirar />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Retirar solicitud' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('ya respondió');
  });

  it('sin permiso no ofrece retirar', () => {
    render(<CambioPendienteGenerador tripId="t-1" cambio={CAMBIO} puedeRetirar={false} />, {
      wrapper,
    });
    expect(screen.queryByRole('button', { name: 'Retirar solicitud' })).not.toBeInTheDocument();
  });
});
