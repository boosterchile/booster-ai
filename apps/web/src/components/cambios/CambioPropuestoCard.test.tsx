import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../../lib/api-client.js';
import {
  type CambioPendienteOficina,
  CambioPropuestoCard,
  mensajeErrorRespuesta,
} from './CambioPropuestoCard.js';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const CAMBIO: CambioPendienteOficina = {
  id: 'sol-1',
  cambios: { weight_kg: 2500 },
  valores_anteriores: { weight_kg: 1000 },
  creado_en: '2026-11-09T15:00:00.000Z',
};

const card = (puedeResponder = true) =>
  render(
    <CambioPropuestoCard
      assignmentId="asg-1"
      cambio={CAMBIO}
      puedeResponder={puedeResponder}
      vehiclePlate="ABCD12"
    />,
    { wrapper },
  );

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('CambioPropuestoCard', () => {
  it('muestra el diff y avisa que bloquea la recogida', () => {
    card();
    expect(screen.getByText('El generador propone un cambio')).toBeInTheDocument();
    expect(
      screen.getByText('No podrás confirmar la recogida hasta responder.'),
    ).toBeInTheDocument();
    expect(screen.getByText('2.500 kg')).toBeInTheDocument();
  });

  it('aceptar llama al endpoint de la solicitud', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ ok: true });
    card();
    fireEvent.click(screen.getByRole('button', { name: 'Aceptar cambio' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/assignments/asg-1/solicitudes-cambio/sol-1/aceptar', {}),
    );
  });

  it('rechazar con motivo manda el motivo sin espacios', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ ok: true });
    card();
    fireEvent.click(screen.getByRole('button', { name: 'Rechazar' }));
    fireEvent.change(screen.getByLabelText('Motivo (opcional)'), {
      target: { value: '  No cabe en el camión ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Rechazar cambio' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/assignments/asg-1/solicitudes-cambio/sol-1/rechazar', {
        reason: 'No cabe en el camión',
      }),
    );
  });

  it('un 422 de capacidad explica qué hacer, con la patente', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(
      new ApiError(422, 'excede_capacidad_vehiculo', { capacidad_kg: 5000, peso_kg: 9000 }),
    );
    card();
    fireEvent.click(screen.getByRole('button', { name: 'Aceptar cambio' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Este peso supera la capacidad de ABCD12 (5.000 kg). Asigna un vehículo con capacidad suficiente o rechaza el cambio.',
    );
  });

  it('con la capacidad del vehículo avisa antes de aceptar un peso que no cabe', () => {
    render(
      <CambioPropuestoCard
        assignmentId="asg-1"
        cambio={CAMBIO}
        puedeResponder
        vehiclePlate="ABCD12"
        vehicleCapacityKg={2000}
      />,
      { wrapper },
    );
    expect(screen.getByTestId('excede-capacidad')).toHaveTextContent(
      'Este peso supera la capacidad de ABCD12 (2.000 kg).',
    );
  });

  it('si el peso cabe no hay aviso', () => {
    render(
      <CambioPropuestoCard
        assignmentId="asg-1"
        cambio={CAMBIO}
        puedeResponder
        vehiclePlate="ABCD12"
        vehicleCapacityKg={5000}
      />,
      { wrapper },
    );
    expect(screen.queryByTestId('excede-capacidad')).not.toBeInTheDocument();
  });

  it('sin permiso para responder no muestra los botones', () => {
    card(false);
    expect(screen.queryByRole('button', { name: 'Aceptar cambio' })).not.toBeInTheDocument();
    expect(screen.getByText(/Solo quien puede aceptar ofertas/)).toBeInTheDocument();
  });
});

describe('mensajeErrorRespuesta', () => {
  it.each([
    [new ApiError(409, 'solicitud_no_vigente', null), /ya no está pendiente/],
    [new ApiError(409, 'solicitud_invalidada', null), /ya no aplica/],
    [new ApiError(422, 'contrato_programado_no_habilitado', null), /contrato programado/],
    [new Error('red'), /No pudimos/],
  ])('%s → mensaje propio', (err, esperado) => {
    expect(mensajeErrorRespuesta(err, null)).toMatch(esperado);
  });
});
