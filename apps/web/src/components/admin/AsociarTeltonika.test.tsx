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

  it('avisa cuando la patente ya existía y quedó en el cliente nuevo', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      empresas: [
        {
          id: 'emp-1',
          razon_social: 'Sociedad de Transportes TransJavier Limitada',
          rut: '76274900-9',
          es_transportista: true,
        },
      ],
    });
    vi.spyOn(api, 'post').mockResolvedValue({
      patente: 'RCPC20',
      razon_social: 'Sociedad de Transportes TransJavier Limitada',
      teltonika_imei: '860693088328266',
      ya_existia: true,
      movido: true,
    });

    render(<AsociarTeltonika />);

    await screen.findByRole('option', { name: /TransJavier/ });
    fireEvent.change(screen.getByTestId('teltonika-empresa'), { target: { value: 'emp-1' } });
    fireEvent.change(screen.getByTestId('teltonika-patente'), { target: { value: 'rcpc20' } });
    fireEvent.change(screen.getByTestId('teltonika-capacidad'), { target: { value: '20000' } });
    fireEvent.change(screen.getByTestId('teltonika-imei'), {
      target: { value: '860693088328266' },
    });
    fireEvent.click(screen.getByTestId('teltonika-habilitar'));

    expect(await screen.findByTestId('teltonika-ok')).toHaveTextContent(
      'El camión RCPC20 ya existía en otra empresa. Quedó en Sociedad de Transportes TransJavier Limitada con el IMEI 860693088328266.',
    );
  });

  it('lista los equipos pendientes y los rechaza desde la plataforma', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/admin/plataforma/dispositivos') {
        return {
          devices: [
            {
              id: 'dev-1',
              imei: '356307042441013',
              ultima_conexion_en: '2026-10-05T10:00:00Z',
              modelo_detectado: 'FMC150',
              cantidad_conexiones: 3,
            },
          ],
        };
      }
      if (path.startsWith('/admin/plataforma/dispositivos/vehiculos')) {
        return { vehiculos: [] };
      }
      return { empresas: [] };
    });
    const post = vi.spyOn(api, 'post').mockResolvedValue({
      device_id: 'dev-1',
      imei: '356307042441013',
      estado: 'rechazado',
    });

    render(<AsociarTeltonika />);
    const boton = await screen.findByTestId('teltonika-rechazar-356307042441013');
    expect(screen.getByTestId('teltonika-pendientes')).toHaveTextContent('FMC150');
    fireEvent.click(boton);

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/admin/plataforma/dispositivos/dev-1/rechazar', {}),
    );
    await waitFor(() =>
      expect(screen.queryByTestId('teltonika-rechazar-356307042441013')).toBeNull(),
    );
    expect(screen.getByTestId('teltonika-ok')).toHaveTextContent('356307042441013');
    expect(screen.getByTestId('teltonika-pendientes')).toHaveTextContent(
      'No hay equipos pendientes',
    );
  });
});
