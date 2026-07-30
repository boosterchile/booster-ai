import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/api-client.js';
import { InvitarMiembroEmpresa } from './InvitarMiembroEmpresa.js';

/**
 * Fase 3.5 — UI de alta de miembro en empresa existente.
 *
 * Cubre el caso que hoy se resuelve con INSERT a mano: sumar al gestor de una
 * empresa ya creada (Van Oosterwyk) y entregarle su link de acceso.
 */

const EMPRESAS = [
  {
    id: '60c344e0-b925-43a6-a7b3-aa6b07fac721',
    razon_social: 'Transportes Van Oosterwyk',
    rut: '76653720-0',
    estado: 'activa',
    es_transportista: true,
    es_generador_carga: false,
  },
];

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('InvitarMiembroEmpresa', () => {
  it('lista las empresas y permite sumar una persona con su rol', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ empresas: EMPRESAS });
    const post = vi.spyOn(api, 'post').mockResolvedValue({
      ok: true,
      user_id: 'user-uuid',
      membership_id: 'membership-uuid',
      rol: 'admin',
      estado: 'activa',
      access_link: 'https://app.boosterchile.com/__/auth/action?oobCode=inv',
    });
    stubClipboard(vi.fn(async () => undefined));

    render(<InvitarMiembroEmpresa />);

    await waitFor(() => screen.getByRole('option', { name: /Transportes Van Oosterwyk/ }));

    fireEvent.change(screen.getByLabelText(/Empresa/i), { target: { value: EMPRESAS[0]?.id } });
    fireEvent.change(screen.getByLabelText(/Nombre completo/i), {
      target: { value: 'Javier Vicencio' },
    });
    fireEvent.change(screen.getByLabelText(/Email/i), {
      target: { value: 'fvicencio@me.com' },
    });
    fireEvent.change(screen.getByLabelText(/Rol/i), { target: { value: 'admin' } });
    fireEvent.click(screen.getByRole('button', { name: /Agregar a la empresa/i }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(`/admin/empresas/${EMPRESAS[0]?.id}/miembros`, {
        email: 'fvicencio@me.com',
        full_name: 'Javier Vicencio',
        rol: 'admin',
      }),
    );

    // El link de acceso queda visible para entregárselo — sin él la persona
    // no puede fijar contraseña ni verificar su correo.
    await waitFor(() =>
      expect(
        screen.getByText('https://app.boosterchile.com/__/auth/action?oobCode=inv'),
      ).toBeInTheDocument(),
    );
  });

  it('avisa cuando la persona ya es miembro, sin dejar el form colgado', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ empresas: EMPRESAS });
    vi.spyOn(api, 'post').mockRejectedValue(
      Object.assign(new Error('conflict'), { code: 'already_member', status: 409 }),
    );

    render(<InvitarMiembroEmpresa />);
    await waitFor(() => screen.getByRole('option', { name: /Transportes Van Oosterwyk/ }));

    fireEvent.change(screen.getByLabelText(/Empresa/i), { target: { value: EMPRESAS[0]?.id } });
    fireEvent.change(screen.getByLabelText(/Nombre completo/i), {
      target: { value: 'Javier Vicencio' },
    });
    fireEvent.change(screen.getByLabelText(/Email/i), {
      target: { value: 'fvicencio@me.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Agregar a la empresa/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Agregar a la empresa/i })).not.toBeDisabled();
  });
});
