import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../../lib/api-client.js';
import {
  type CargaActual,
  SolicitarCambioForm,
  cambiosDesdeFormulario,
  mensajeErrorSolicitud,
} from './SolicitarCambioForm.js';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const ACTUAL: CargaActual = {
  origin_address_raw: 'Av. Apoquindo 4500, Las Condes',
  origin_region_code: 'XIII',
  destination_address_raw: 'Av. Libertad 100, Viña del Mar',
  destination_region_code: 'V',
  cargo_type: 'carga_seca',
  cargo_weight_kg: 1000,
  cargo_volume_m3: null,
  cargo_description: null,
  pickup_window_start: '2026-11-20T12:00:00.000Z',
  pickup_window_end: '2026-11-20T15:00:00.000Z',
  proposed_price_clp: 800_000,
  modalidad_carga: 'spot',
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('cambiosDesdeFormulario', () => {
  const sinCambios = {
    origen: ACTUAL.origin_address_raw,
    origenRegion: 'XIII',
    destino: ACTUAL.destination_address_raw,
    destinoRegion: 'V',
    tipo: 'carga_seca',
    peso: '1000',
    volumen: '',
    descripcion: '',
    desde: '',
    hasta: '',
    precio: '800000',
    modalidad: 'spot',
  };

  it('sin tocar nada no propone nada', () => {
    expect(cambiosDesdeFormulario(ACTUAL, sinCambios)).toEqual({});
  });

  it('envía solo lo que cambió', () => {
    expect(
      cambiosDesdeFormulario(ACTUAL, {
        ...sinCambios,
        peso: '2500',
        precio: '900000',
        modalidad: 'programada',
        destino: 'Puerto de San Antonio',
      }),
    ).toEqual({
      destination: { address_raw: 'Puerto de San Antonio', region_code: 'V' },
      weight_kg: 2500,
      proposed_price_clp: 900_000,
      modalidad_carga: 'programada',
    });
  });

  it('una descripción vaciada se borra con null', () => {
    expect(
      cambiosDesdeFormulario(
        { ...ACTUAL, cargo_description: 'Pallets' },
        { ...sinCambios, descripcion: '  ' },
      ),
    ).toEqual({ description: null });
  });
});

describe('SolicitarCambioForm', () => {
  it('avisa que la recogida queda bloqueada y envía solo los cambios', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ solicitud: { id: 's1' } });
    const onListo = vi.fn();
    render(<SolicitarCambioForm tripId="t-1" actual={ACTUAL} onListo={onListo} />, { wrapper });
    expect(
      screen.getByText('El transportista no podrá confirmar la recogida hasta responder.'),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Peso (kg)'), { target: { value: '2500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar al transportista' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/trip-requests-v2/t-1/solicitudes-cambio', {
        cambios: { weight_kg: 2500 },
      }),
    );
    await waitFor(() => expect(onListo).toHaveBeenCalled());
  });

  it('sin cambios no llama al API', () => {
    const post = vi.spyOn(api, 'post');
    render(<SolicitarCambioForm tripId="t-1" actual={ACTUAL} onListo={vi.fn()} />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar al transportista' }));
    expect(screen.getByRole('alert')).toHaveTextContent('No cambiaste ningún dato.');
    expect(post).not.toHaveBeenCalled();
  });

  it('un error del API se explica en español', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(409, 'cambio_pendiente_existente', null));
    render(<SolicitarCambioForm tripId="t-1" actual={ACTUAL} onListo={vi.fn()} />, { wrapper });
    fireEvent.change(screen.getByLabelText('Peso (kg)'), { target: { value: '2500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar al transportista' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ya hay un cambio esperando');
  });
});

describe('mensajeErrorSolicitud', () => {
  it.each([
    [new ApiError(422, 'contrato_programado_no_habilitado', null), /contrato programado/],
    [new ApiError(409, 'trip_not_editable', null), /recogida/],
    [new ApiError(400, undefined, null), /30 minutos/],
    [new Error('red'), /No pudimos/],
  ])('%s → mensaje propio', (err, esperado) => {
    expect(mensajeErrorSolicitud(err)).toMatch(esperado);
  });
});
