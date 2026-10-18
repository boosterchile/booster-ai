import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../../lib/api-client.js';
import { RecepcionYPagoCard } from './RecepcionYPagoCard.js';

const PAGO = {
  modo_flujo: 'mandato_cobro',
  recepcion_conforme_en: '2026-10-10T12:00:00.000Z',
  cobro: { estado: 'pendiente', en: null, monto_clp: null, vence_en: '2026-11-09T12:00:00.000Z' },
  liberacion: {
    estado: 'pendiente',
    en: null,
    monto_clp: null,
    vence_en: '2026-10-15T12:00:00.000Z',
  },
  montos_esperados: { cobro_clp: 1_238_000, liberacion_clp: 1_000_000 },
};

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('RecepcionYPagoCard (ADR-080)', () => {
  it('carga en curso: botón Confirmar recepción, sin consultar el pago', async () => {
    const get = vi.spyOn(api, 'get');
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({ ok: true });
    wrap(<RecepcionYPagoCard tripId="t1" status="en_proceso" />);
    await userEvent.click(screen.getByRole('button', { name: /confirmar recepción/i }));
    expect(patch).toHaveBeenCalledWith('/trip-requests-v2/t1/confirmar-recepcion');
    expect(await screen.findByText('Recepción confirmada.')).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });

  it('sin documento: explica qué subir', async () => {
    vi.spyOn(api, 'patch').mockRejectedValue(
      new ApiError(409, 'documento_requerido', {}, 'documento_requerido'),
    );
    wrap(<RecepcionYPagoCard tripId="t1" status="asignado" />);
    await userEvent.click(screen.getByRole('button', { name: /confirmar recepción/i }));
    expect(await screen.findByText(/sube primero el documento del viaje/i)).toBeInTheDocument();
  });

  it('entregada sin mandato (404): no muestra nada', async () => {
    const get = vi.spyOn(api, 'get').mockRejectedValue(new ApiError(404, undefined, {}));
    const { container } = wrap(<RecepcionYPagoCard tripId="t1" status="entregado" />);
    await waitFor(() => expect(get).toHaveBeenCalledWith('/trip-requests-v2/t1/pago'));
    expect(container).toBeEmptyDOMElement();
  });

  it('entregada bajo mandato: monto, vencimiento y estado del pago al transportista', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ pago: PAGO });
    wrap(<RecepcionYPagoCard tripId="t1" status="entregado" />);
    expect(await screen.findByText(/Pendiente de pago/)).toBeInTheDocument();
    expect(screen.getByText(/1\.238\.000/)).toBeInTheDocument();
    expect(screen.getByText(/Vence el/)).toBeInTheDocument();
    expect(screen.getByText('Pendiente')).toBeInTheDocument();
    // Recepción ya registrada: no vuelve a ofrecer confirmar.
    expect(screen.queryByRole('button', { name: /confirmar recepción/i })).toBeNull();
  });

  it('entregada por POD del transportista sin recepción: ofrece confirmar', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      pago: {
        ...PAGO,
        recepcion_conforme_en: null,
        cobro: { ...PAGO.cobro, estado: 'sin_recepcion', vence_en: null },
        liberacion: { ...PAGO.liberacion, estado: 'sin_recepcion', vence_en: null },
      },
    });
    vi.spyOn(api, 'patch').mockResolvedValue({ recepcion_conforme_pendiente: 'sin_documento' });
    wrap(<RecepcionYPagoCard tripId="t1" status="entregado" />);
    await userEvent.click(await screen.findByRole('button', { name: /confirmar recepción/i }));
    expect(await screen.findByText(/para registrar la recepción conforme/i)).toBeInTheDocument();
  });

  it('objetar recepción: exige motivo y envía la disputa', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ pago: PAGO });
    const post = vi.spyOn(api, 'post').mockResolvedValue({ pago: PAGO });
    wrap(<RecepcionYPagoCard tripId="t1" status="entregado" />);
    await userEvent.click(await screen.findByRole('button', { name: /objetar recepción/i }));
    const enviar = screen.getByRole('button', { name: /enviar objeción/i });
    expect(enviar).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/qué problema/i), 'Llegaron 3 pallets dañados');
    await userEvent.click(enviar);
    expect(post).toHaveBeenCalledWith('/trip-requests-v2/t1/disputa', {
      motivo: 'Llegaron 3 pallets dañados',
    });
    expect(await screen.findByText(/Registramos tu objeción/)).toBeInTheDocument();
  });

  it('objeción rechazada: muestra el motivo en lenguaje claro', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ pago: PAGO });
    vi.spyOn(api, 'post').mockRejectedValue(
      new ApiError(409, undefined, {}, 'liberacion_no_pendiente'),
    );
    wrap(<RecepcionYPagoCard tripId="t1" status="entregado" />);
    await userEvent.click(await screen.findByRole('button', { name: /objetar recepción/i }));
    await userEvent.type(screen.getByLabelText(/qué problema/i), 'Llegaron 3 pallets dañados');
    await userEvent.click(screen.getByRole('button', { name: /enviar objeción/i }));
    expect(await screen.findByText(/ya recibió su pago/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /volver/i }));
    expect(screen.queryByLabelText(/qué problema/i)).toBeNull();
  });

  it('error desconocido: mensaje genérico', async () => {
    vi.spyOn(api, 'patch').mockRejectedValue(new Error('red'));
    wrap(<RecepcionYPagoCard tripId="t1" status="asignado" />);
    await userEvent.click(screen.getByRole('button', { name: /confirmar recepción/i }));
    expect(await screen.findByText(/No pudimos completar la acción/)).toBeInTheDocument();
  });
});
