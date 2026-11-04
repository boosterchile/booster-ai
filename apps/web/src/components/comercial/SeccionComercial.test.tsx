import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../../lib/api-client.js';
import { DesgloseGenerador, SeccionComercial } from './SeccionComercial.js';

const DESGLOSE = {
  modalidad_carga: 'spot' as const,
  precio_transportista_clp: 700_000,
  comision_pct: 20,
  comision_clp: 140_000,
  iva_comision_clp: 26_600,
  precio_generador_clp: 840_000,
  total_factura_generador_clp: 166_600,
};

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SeccionComercial (ADR-079 §1)', () => {
  it('v3 apagado (404): no muestra nada', async () => {
    const get = vi
      .spyOn(api, 'get')
      .mockRejectedValue(new ApiError(404, 'pricing_v3_disabled', {}));
    const { container } = wrap(
      <SeccionComercial precioClp={700_000} modalidad="spot" onModalidad={vi.fn()} />,
    );
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('muestra el desglose del generador para el precio y la modalidad', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({
      configuracion_version: 3,
      programada_disponible: false,
      desglose: DESGLOSE,
    });
    wrap(<SeccionComercial precioClp={700_000} modalidad="spot" onModalidad={vi.fn()} />);
    expect(await screen.findByText('$866.600')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith(
      '/trip-requests-v2/cotizacion?precio_transportista_clp=700000&modalidad_carga=spot',
    );
    expect(screen.queryByLabelText('Carga programada')).not.toBeInTheDocument();
  });

  it('con contrato programado ofrece la modalidad programada', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      configuracion_version: 3,
      programada_disponible: true,
      desglose: DESGLOSE,
    });
    const onModalidad = vi.fn();
    const user = userEvent.setup();
    wrap(<SeccionComercial precioClp={700_000} modalidad="spot" onModalidad={onModalidad} />);
    await user.click(await screen.findByLabelText('Carga programada'));
    expect(onModalidad).toHaveBeenCalledWith('programada');
  });

  it('sin precio: cotiza con 0 para saber la disponibilidad y pide el precio', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({
      configuracion_version: 3,
      programada_disponible: false,
      desglose: { ...DESGLOSE, precio_transportista_clp: 0 },
    });
    wrap(<SeccionComercial precioClp={null} modalidad="spot" onModalidad={vi.fn()} />);
    expect(await screen.findByText(/Ingresa el precio/)).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith(
      '/trip-requests-v2/cotizacion?precio_transportista_clp=0&modalidad_carga=spot',
    );
  });

  it('respuesta fuera de contrato: no muestra nada', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ cualquier: 'cosa' });
    const { container } = wrap(
      <SeccionComercial precioClp={700_000} modalidad="spot" onModalidad={vi.fn()} />,
    );
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});

describe('DesgloseGenerador', () => {
  it('lista precio del transportista, comisión, IVA y total', () => {
    render(<DesgloseGenerador desglose={DESGLOSE} />);
    expect(screen.getByText('$700.000')).toBeInTheDocument();
    expect(screen.getByText(/20 %/)).toBeInTheDocument();
    expect(screen.getByText('$140.000')).toBeInTheDocument();
    expect(screen.getByText('$26.600')).toBeInTheDocument();
    expect(screen.getByText('$866.600')).toBeInTheDocument();
  });
});
