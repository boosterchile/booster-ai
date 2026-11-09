import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../../lib/api-client.js';
import {
  ContactoYNotasCard,
  type DatosLibresCarga,
  mensajeErrorDatosLibres,
} from './ContactoYNotasCard.js';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const DATOS: DatosLibresCarga = {
  consignee: { name: 'Bodega La Serena', phone_e164: '+56911111111', email: null },
  notes: 'Andén 4',
  reference: null,
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('ContactoYNotasCard', () => {
  it('muestra destinatario, notas y referencia', () => {
    render(<ContactoYNotasCard tripId="t-1" datos={DATOS} editable />, { wrapper });
    expect(screen.getByText('Bodega La Serena · +56911111111')).toBeInTheDocument();
    expect(screen.getByText('Andén 4')).toBeInTheDocument();
    expect(screen.getByText('Sin referencia')).toBeInTheDocument();
  });

  it('sin permiso o con la carga terminada no ofrece editar', () => {
    render(<ContactoYNotasCard tripId="t-1" datos={DATOS} editable={false} />, { wrapper });
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument();
  });

  it('guarda los cambios por PATCH y vuelve al resumen', async () => {
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({ trip_request: { id: 't-1' } });
    render(<ContactoYNotasCard tripId="t-1" datos={DATOS} editable />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    fireEvent.change(screen.getByLabelText('Notas para el transportista'), {
      target: { value: 'Andén 6, después de las 14:00' },
    });
    fireEvent.change(screen.getByLabelText('Referencia'), { target: { value: 'PO-77' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/trip-requests-v2/t-1/datos-libres', {
        consignee: { name: 'Bodega La Serena', phone_e164: '+56911111111' },
        notes: 'Andén 6, después de las 14:00',
        reference: 'PO-77',
      }),
    );
    expect(await screen.findByRole('button', { name: 'Editar' })).toBeInTheDocument();
  });

  it('si el enlace de seguimiento cambió, lo avisa al volver al resumen', async () => {
    vi.spyOn(api, 'patch').mockResolvedValue({
      trip_request: { id: 't-1', campos: ['consignee'], enlace_seguimiento_renovado: true },
    });
    render(<ContactoYNotasCard tripId="t-1" datos={DATOS} editable />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    fireEvent.change(screen.getByLabelText('WhatsApp del destinatario'), {
      target: { value: '+56922222222' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'El enlace de seguimiento cambió. El anterior dejó de funcionar.',
    );
    // Al volver a editar, el aviso se va.
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('si el enlace no cambió, no avisa', async () => {
    vi.spyOn(api, 'patch').mockResolvedValue({
      trip_request: { id: 't-1', campos: ['notes'], enlace_seguimiento_renovado: false },
    });
    render(<ContactoYNotasCard tripId="t-1" datos={DATOS} editable />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByRole('button', { name: 'Editar' })).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('vaciar los datos del destinatario manda null', async () => {
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({});
    render(<ContactoYNotasCard tripId="t-1" datos={DATOS} editable />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    fireEvent.change(screen.getByLabelText('Nombre del destinatario'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('WhatsApp del destinatario'), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(patch).toHaveBeenCalled());
    const [, body] = patch.mock.calls[0] as [string, { consignee: unknown }];
    expect(body.consignee).toBeNull();
  });

  it('un error del API se muestra en español y el formulario sigue abierto', async () => {
    vi.spyOn(api, 'patch').mockRejectedValue(new ApiError(422, 'sin_cambios', null));
    render(<ContactoYNotasCard tripId="t-1" datos={DATOS} editable />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No cambiaste ningún dato.');
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeInTheDocument();
  });

  it('Cancelar cierra el formulario sin guardar', () => {
    const patch = vi.spyOn(api, 'patch');
    render(<ContactoYNotasCard tripId="t-1" datos={DATOS} editable />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByRole('button', { name: 'Editar' })).toBeInTheDocument();
    expect(patch).not.toHaveBeenCalled();
  });
});

describe('mensajeErrorDatosLibres', () => {
  it.each([
    [new ApiError(409, 'trip_not_editable', null), /ya terminó/],
    [new ApiError(403, 'read_only', null), /Tu rol/],
    [new ApiError(403, 'capability_denied', null), /Tu rol/],
    [new ApiError(400, undefined, null), /\+56912345678/],
    [new Error('red'), /No pudimos guardar/],
  ])('%s → mensaje propio', (err, esperado) => {
    expect(mensajeErrorDatosLibres(err)).toMatch(esperado);
  });
});
