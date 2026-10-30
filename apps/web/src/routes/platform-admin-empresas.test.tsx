import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api-client.js';

/**
 * acceso-usuarios-empresa-panel SC7 — `/app/platform-admin/empresas`.
 *
 * Al invitar a una persona, la lista de empresas se refresca y la invitación
 * pendiente aparece con su botón «Generar código nuevo», sin recargar la
 * página.
 */

vi.mock('../components/ProtectedRoute.js', () => ({
  ProtectedRoute: ({ children }: { children: (ctx: { kind: 'unmanaged' }) => ReactNode }) => (
    <>{children({ kind: 'unmanaged' })}</>
  ),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...rest }: { children: ReactNode; to: string }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('../hooks/use-auth.js', () => ({ signOutUser: vi.fn(async () => undefined) }));

vi.mock('../hooks/use-me.js', () => ({ useMe: () => ({ data: undefined }) }));

const { PlatformAdminEmpresasRoute } = await import('./platform-admin-empresas.js');

const EMPRESA_ID = 'b1d7a2c4-1111-4a2b-9c3d-000000000001';
const MEMBERSHIP_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

const EMPRESA = {
  id: EMPRESA_ID,
  razon_social: 'Retail Norte SpA',
  rut: '76274900-9',
  estado: 'activa',
  es_transportista: false,
  es_generador_carga: true,
  miembros_pendientes: [] as unknown[],
  dueno_pendiente: null,
};

const PENDIENTE = {
  user_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  membership_id: MEMBERSHIP_ID,
  nombre: 'Javier Vicencio',
  rut: '12345678-5',
  email: 'fvicencio@me.com',
  rol: 'dueno',
  invitado_en: '2026-10-30T15:00:00.000Z',
  expira_en: '2026-11-06T15:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('/app/platform-admin/empresas', () => {
  it('al invitar a una persona, su invitación pendiente aparece con «Generar código nuevo»', async () => {
    let empresas = [EMPRESA];
    const get = vi.spyOn(api, 'get').mockImplementation(async () => ({ empresas }));
    vi.spyOn(api, 'post').mockImplementation(async () => {
      empresas = [{ ...EMPRESA, miembros_pendientes: [PENDIENTE] }];
      return {
        ok: true,
        user_id: PENDIENTE.user_id,
        membership_id: MEMBERSHIP_ID,
        rol: 'dueno',
        estado: 'pendiente_invitacion',
        codigo_activacion: '482915',
        expira_en: PENDIENTE.expira_en,
        vinculo: 'nueva',
      };
    });

    render(<PlatformAdminEmpresasRoute />);

    expect(await screen.findByTestId(`empresa-row-${EMPRESA_ID}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`reemitir-codigo-${MEMBERSHIP_ID}`)).not.toBeInTheDocument();
    const llamadasAntes = get.mock.calls.length;

    fireEvent.change(screen.getByLabelText(/^Empresa$/i), { target: { value: EMPRESA_ID } });
    fireEvent.change(screen.getByLabelText(/Nombre completo/i), {
      target: { value: 'Javier Vicencio' },
    });
    fireEvent.change(screen.getByLabelText(/^RUT$/i), { target: { value: '12345678-5' } });
    fireEvent.change(screen.getByLabelText(/^Email$/i), { target: { value: 'fvicencio@me.com' } });
    fireEvent.click(screen.getByRole('button', { name: /Agregar a la empresa/i }));

    expect(await screen.findByTestId(`reemitir-codigo-${MEMBERSHIP_ID}`)).toHaveTextContent(
      'Generar código nuevo',
    );
    expect(get.mock.calls.length).toBeGreaterThan(llamadasAntes);
  });
});
