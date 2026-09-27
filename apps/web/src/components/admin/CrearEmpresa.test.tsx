import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../../lib/api-client.js';
import { CrearEmpresa } from './CrearEmpresa.js';

beforeEach(() => {
  vi.clearAllMocks();
});

function fillForm() {
  fireEvent.change(screen.getByLabelText(/Razón social/i), {
    target: { value: 'Retail Norte SpA' },
  });
  fireEvent.change(screen.getByLabelText(/RUT de la empresa/i), {
    target: { value: '12345678-5' },
  });
  fireEvent.change(screen.getByLabelText(/Email de contacto/i), {
    target: { value: 'contacto@retailnorte.cl' },
  });
  fireEvent.change(screen.getByLabelText(/^Teléfono$/i), {
    target: { value: '+56912345678' },
  });
  fireEvent.change(screen.getByLabelText(/Calle y número/i), {
    target: { value: 'Av. Apoquindo 3000' },
  });
  fireEvent.change(screen.getByLabelText(/^Ciudad$/i), { target: { value: 'Santiago' } });
}

describe('CrearEmpresa', () => {
  it('crea un generador de carga y avisa que quedó en verificación', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({
      ok: true,
      empresa_id: 'empresa-nueva-uuid',
      razon_social: 'Retail Norte SpA',
      rut: '12345678-5',
      estado: 'pendiente_verificacion',
      es_generador_carga: true,
      es_transportista: false,
      plan_slug: 'gratis',
    });
    const onCreated = vi.fn();

    render(<CrearEmpresa onCreated={onCreated} />);
    fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Crear empresa' }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/admin/empresas', {
        legal_name: 'Retail Norte SpA',
        rut: '12345678-5',
        contact_email: 'contacto@retailnorte.cl',
        contact_phone: '+56912345678',
        address_street: 'Av. Apoquindo 3000',
        address_city: 'Santiago',
        address_region: 'XIII',
        is_generador_carga: true,
        is_transportista: false,
      }),
    );

    expect(await screen.findByTestId('empresa-creada')).toHaveTextContent('generador de carga');
    expect(onCreated).toHaveBeenCalledWith('empresa-nueva-uuid');
  });

  it('explica el RUT duplicado y no deja el botón trabado', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(
      new ApiError(409, 'rut_already_registered', undefined, 'conflict'),
    );

    render(<CrearEmpresa onCreated={vi.fn()} />);
    fillForm();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Generador de carga' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Transportista' }));
    fireEvent.click(screen.getByRole('button', { name: 'Crear empresa' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Ya existe una empresa con ese RUT.',
    );
    expect(screen.getByRole('button', { name: 'Crear empresa' })).not.toBeDisabled();
  });

  it('no envía la ficha si no hay rol', () => {
    const post = vi.spyOn(api, 'post');
    render(<CrearEmpresa onCreated={vi.fn()} />);
    fillForm();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Generador de carga' }));

    expect(screen.getByRole('button', { name: 'Crear empresa' })).toBeDisabled();
    expect(post).not.toHaveBeenCalled();
  });
});
