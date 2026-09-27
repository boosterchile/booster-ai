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
});
