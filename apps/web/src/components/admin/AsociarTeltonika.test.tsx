import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/api-client.js';
import { AsociarTeltonika } from './AsociarTeltonika.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AsociarTeltonika', () => {
  it('asocia un pendiente al camión del transportista elegido', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path.startsWith('/admin/plataforma/dispositivos/vehiculos')) {
        return { vehiculos: [{ id: 'veh-1', patente: 'ABCD12', teltonika_imei: null }] };
      }
      if (path === '/admin/plataforma/dispositivos') {
        return {
          devices: [
            {
              id: 'dev-1',
              imei: '356307042441013',
              ultima_conexion_en: '2026-09-27T00:00:00.000Z',
              modelo_detectado: 'FMC150',
              cantidad_conexiones: 2,
            },
          ],
        };
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
      imei: '356307042441013',
    });

    render(<AsociarTeltonika />);

    await screen.findByRole('option', { name: /356307042441013/ });
    fireEvent.change(screen.getByTestId('teltonika-device'), { target: { value: 'dev-1' } });
    fireEvent.change(screen.getByTestId('teltonika-empresa'), { target: { value: 'emp-1' } });
    await screen.findByRole('option', { name: /ABCD12/ });
    fireEvent.change(screen.getByTestId('teltonika-vehiculo'), { target: { value: 'veh-1' } });
    fireEvent.click(screen.getByTestId('teltonika-asociar'));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/admin/plataforma/dispositivos/dev-1/asociar', {
        vehiculo_id: 'veh-1',
      }),
    );
    expect(await screen.findByTestId('teltonika-ok')).toHaveTextContent('ABCD12');
  });
});
