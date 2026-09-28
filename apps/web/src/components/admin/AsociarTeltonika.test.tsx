import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/api-client.js';
import { AsociarTeltonika } from './AsociarTeltonika.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AsociarTeltonika', () => {
  it('escribe el IMEI instalado en el camión elegido', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path.startsWith('/admin/plataforma/dispositivos/vehiculos')) {
        return { vehiculos: [{ id: 'veh-1', patente: 'ABCD12', teltonika_imei: null }] };
      }
      return {
        empresas: [
          {
            id: 'emp-1',
            razon_social: 'Transportes Sur E2E SpA',
            rut: '76111222-8',
            es_transportista: true,
          },
        ],
      };
    });
    const post = vi.spyOn(api, 'post').mockResolvedValue({
      patente: 'ABCD12',
      teltonika_imei: '356307042441013',
    });

    render(<AsociarTeltonika />);

    fireEvent.click(await screen.findByTestId('teltonika-modo-existente'));
    await screen.findByRole('option', { name: /Transportes Sur E2E SpA/ });
    fireEvent.change(screen.getByTestId('teltonika-empresa'), { target: { value: 'emp-1' } });
    await screen.findByRole('option', { name: /ABCD12/ });
    fireEvent.change(screen.getByTestId('teltonika-vehiculo'), { target: { value: 'veh-1' } });
    fireEvent.change(screen.getByTestId('teltonika-imei'), {
      target: { value: '356307042441013' },
    });
    fireEvent.click(screen.getByTestId('teltonika-asociar'));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/admin/plataforma/dispositivos/asignar', {
        vehiculo_id: 'veh-1',
        teltonika_imei: '356307042441013',
      }),
    );
    expect(await screen.findByTestId('teltonika-ok')).toHaveTextContent('356307042441013');
  });

  it('carga el vehículo en la empresa y le escribe el IMEI', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      empresas: [
        {
          id: 'emp-1',
          razon_social: 'Transportes Sur E2E SpA',
          rut: '76111222-8',
          es_transportista: true,
        },
      ],
    });
    const post = vi.spyOn(api, 'post').mockResolvedValue({
      patente: 'ABCD12',
      razon_social: 'Transportes Sur E2E SpA',
      teltonika_imei: '356307042441013',
    });

    render(<AsociarTeltonika />);

    expect(
      screen.getByText(/La empresa también puede cargar esos datos desde su flota/),
    ).toBeInTheDocument();
    await screen.findByRole('option', { name: /Transportes Sur E2E SpA/ });
    fireEvent.change(screen.getByTestId('teltonika-empresa'), { target: { value: 'emp-1' } });
    fireEvent.change(screen.getByTestId('teltonika-patente'), { target: { value: 'abcd12' } });
    fireEvent.change(screen.getByTestId('teltonika-capacidad'), { target: { value: '3500' } });
    fireEvent.change(screen.getByTestId('teltonika-marca'), { target: { value: 'Volvo' } });
    fireEvent.change(screen.getByTestId('teltonika-imei'), {
      target: { value: '356307042441013' },
    });
    fireEvent.click(screen.getByTestId('teltonika-habilitar'));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/admin/plataforma/dispositivos/habilitar', {
        empresa_id: 'emp-1',
        teltonika_imei: '356307042441013',
        plate: 'ABCD12',
        vehicle_type: 'camion_pequeno',
        capacity_kg: 3500,
        brand: 'Volvo',
      }),
    );
    expect(await screen.findByTestId('teltonika-ok')).toHaveTextContent('Transportes Sur E2E SpA');
  });
});
