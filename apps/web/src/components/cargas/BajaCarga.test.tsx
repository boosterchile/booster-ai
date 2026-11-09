import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../../lib/api-client.js';
import { BajaCarga, EstadoBajaCarga, mensajeErrorBaja } from './BajaCarga.js';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('BajaCarga — anular', () => {
  it('avisa que la carga sale de las listas y anula sin motivo', async () => {
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({});
    render(<BajaCarga tripId="t-1" modo="anular" />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Anular carga' }));
    expect(screen.getByText(/dejará de aparecer en tus listas/)).toBeInTheDocument();
    expect(screen.getByLabelText('Motivo (opcional)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sí, anular carga' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/trip-requests-v2/t-1/cancelar', {}));
    expect(await screen.findByRole('button', { name: 'Anular carga' })).toBeInTheDocument();
  });
});

describe('BajaCarga — cancelar', () => {
  it('exige motivo antes de llamar al API', () => {
    const patch = vi.spyOn(api, 'patch');
    render(<BajaCarga tripId="t-1" modo="cancelar" telefonoConductor={null} />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar servicio' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sí, cancelar servicio' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Escribe el motivo');
    expect(patch).not.toHaveBeenCalled();
  });

  it('muestra el teléfono del conductor y manda el motivo', async () => {
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({});
    render(<BajaCarga tripId="t-1" modo="cancelar" telefonoConductor="+56977777777" />, {
      wrapper,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar servicio' }));
    expect(screen.getByText(/llama al conductor: \+56977777777/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Motivo'), {
      target: { value: '  El cliente postergó  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sí, cancelar servicio' }));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/trip-requests-v2/t-1/cancelar', {
        reason: 'El cliente postergó',
      }),
    );
  });

  it('sin teléfono, el aviso queda sin él', () => {
    render(<BajaCarga tripId="t-1" modo="cancelar" />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar servicio' }));
    expect(
      screen.getByText('Avisaremos al transportista y al conductor por la app.'),
    ).toBeInTheDocument();
  });

  it('un 409 se explica en español y el panel sigue abierto', async () => {
    vi.spyOn(api, 'patch').mockRejectedValue(new ApiError(409, 'trip_not_cancellable', null));
    render(<BajaCarga tripId="t-1" modo="cancelar" />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar servicio' }));
    fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sí, cancelar servicio' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('cambió de estado');
  });
});

describe('mensajeErrorBaja', () => {
  it.each([
    [new ApiError(422, 'reason_required', null), /motivo/],
    [new ApiError(403, 'read_only', null), /Tu rol/],
    [new Error('red'), /No pudimos/],
  ])('%s → mensaje propio', (err, esperado) => {
    expect(mensajeErrorBaja(err)).toMatch(esperado);
  });
});

describe('EstadoBajaCarga', () => {
  it('anulada: fecha, autor y motivo', () => {
    render(
      <EstadoBajaCarga
        anulacion={{ en: '2026-11-09T16:00:00Z', por_nombre: 'Ana Pérez', razon: 'Duplicada' }}
        cancelacion={null}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(/Anulada el .* por Ana Pérez\./);
    expect(screen.getByText('Motivo: Duplicada')).toBeInTheDocument();
  });

  it('cancelada: fecha y motivo', () => {
    render(
      <EstadoBajaCarga
        anulacion={null}
        cancelacion={{ en: '2026-11-09T16:00:00Z', razon: 'Postergado' }}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(/Cancelada el /);
    expect(screen.getByText('Motivo: Postergado')).toBeInTheDocument();
  });

  it('sin baja no muestra nada', () => {
    const { container } = render(<EstadoBajaCarga anulacion={null} cancelacion={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
