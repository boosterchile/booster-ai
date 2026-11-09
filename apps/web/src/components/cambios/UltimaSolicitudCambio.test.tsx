import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/api-client.js';
import { UltimaSolicitudCambio } from './UltimaSolicitudCambio.js';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function solicitud(over: Record<string, unknown>) {
  return {
    id: 'sol-1',
    estado: 'aceptada',
    cambios: { weight_kg: 12_000 },
    valores_anteriores: { weight_kg: 10_000 },
    creado_en: '2026-11-09T15:00:00.000Z',
    respondido_en: '2026-11-09T16:00:00.000Z',
    razon_respuesta: null,
    motivo_invalidacion: null,
    cerrado_en: '2026-11-09T16:00:00.000Z',
    ...over,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('UltimaSolicitudCambio', () => {
  it('pide el historial del viaje y muestra la última cerrada (rechazada con motivo)', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({
      solicitudes: [
        solicitud({ id: 'sol-2', estado: 'rechazada', razon_respuesta: 'No tengo camión ese día' }),
        solicitud({ id: 'sol-1', estado: 'aceptada' }),
      ],
    });
    render(<UltimaSolicitudCambio tripId="t-1" />, { wrapper });
    expect(await screen.findByText('El transportista rechazó tu cambio')).toBeInTheDocument();
    expect(screen.getByText(/No tengo camión ese día/)).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/trip-requests-v2/t-1/solicitudes-cambio');
  });

  it('aceptada', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ solicitudes: [solicitud({})] });
    render(<UltimaSolicitudCambio tripId="t-1" />, { wrapper });
    expect(await screen.findByText('El transportista aceptó tu cambio')).toBeInTheDocument();
  });

  it('retirada', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      solicitudes: [solicitud({ estado: 'retirada', respondido_en: null })],
    });
    render(<UltimaSolicitudCambio tripId="t-1" />, { wrapper });
    expect(await screen.findByText('Retiraste la solicitud de cambio')).toBeInTheDocument();
  });

  it('invalidada muestra el motivo legible', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      solicitudes: [solicitud({ estado: 'invalidada', motivo_invalidacion: 'viaje_cancelado' })],
    });
    render(<UltimaSolicitudCambio tripId="t-1" />, { wrapper });
    expect(await screen.findByText('La solicitud de cambio quedó sin efecto')).toBeInTheDocument();
    expect(screen.getByText(/El servicio se canceló/)).toBeInTheDocument();
  });

  it('salta la pendiente y sin cerradas no muestra nada', async () => {
    const get = vi
      .spyOn(api, 'get')
      .mockResolvedValue({ solicitudes: [solicitud({ estado: 'pendiente' })] });
    const { container } = render(<UltimaSolicitudCambio tripId="t-1" />, { wrapper });
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
