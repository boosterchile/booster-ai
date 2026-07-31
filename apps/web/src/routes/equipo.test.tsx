import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api-client.js';

/**
 * equipo-de-la-empresa Fase A — sección Equipo en la app del CLIENTE.
 *
 * La empresa gestiona su propia gente: Booster no interviene. Al dar de alta,
 * recibe un código de un solo uso para entregarle a la persona; esa persona
 * elige después su propia clave, así que el código no es una contraseña.
 */

vi.mock('../components/ProtectedRoute.js', () => ({
  ProtectedRoute: ({ children }: { children: (ctx: { kind: 'unmanaged' }) => ReactNode }) => (
    <>{children({ kind: 'unmanaged' })}</>
  ),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
  useNavigate: () => vi.fn(),
}));

const { EquipoRoute } = await import('./equipo.js');

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const MIEMBROS = [
  {
    membership_id: 'm1',
    user_id: 'u1',
    full_name: 'Gabriel Barros',
    email: 'gobe00@gmail.com',
    rut: '8601693-1',
    rol: 'admin',
    estado: 'activa',
    invitado_en: '2026-07-20T10:00:00Z',
  },
  {
    membership_id: 'm2',
    user_id: 'u2',
    full_name: 'Marta Rojas',
    email: 'pendiente@empresa.cl',
    rut: '17111222-3',
    rol: 'despachador',
    estado: 'pendiente_invitacion',
    invitado_en: '2026-07-30T10:00:00Z',
  },
];

function stubClipboard() {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn(async () => undefined) },
    configurable: true,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  stubClipboard();
});

describe('Equipo — listado', () => {
  it('muestra a las personas de la empresa con su rol y estado', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ miembros: MIEMBROS });

    render(<EquipoRoute />, { wrapper: makeWrapper() });

    expect(await screen.findByText('Gabriel Barros')).toBeInTheDocument();
    expect(screen.getByText('gobe00@gmail.com')).toBeInTheDocument();
    // A quien todavía no activó se lo distingue: la empresa tiene que saber a
    // quién le falta entregar (o reenviar) el código.
    expect(screen.getByText('Pendiente de activar')).toBeInTheDocument();
    expect(screen.getByText('Activa')).toBeInTheDocument();
  });

  it('con equipo vacío explica qué hacer', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ miembros: [] });

    render(<EquipoRoute />, { wrapper: makeWrapper() });

    expect(await screen.findByText(/todavía no|aún no/i)).toBeInTheDocument();
  });
});

describe('Equipo — alta', () => {
  async function abrirFormYCompletar() {
    vi.spyOn(api, 'get').mockResolvedValue({ miembros: [] });
    render(<EquipoRoute />, { wrapper: makeWrapper() });
    await screen.findByText(/todavía no|aún no/i);

    fireEvent.click(screen.getByRole('button', { name: /Agregar persona/i }));
    fireEvent.change(screen.getByLabelText(/Nombre completo/i), {
      target: { value: 'Gabriel Barros' },
    });
    fireEvent.change(screen.getByLabelText(/^RUT/i), { target: { value: '8.601.693-1' } });
    fireEvent.change(screen.getByLabelText(/Email/i), { target: { value: 'gobe00@gmail.com' } });
    fireEvent.change(screen.getByLabelText(/Rol/i), { target: { value: 'admin' } });
  }

  it('envía el alta y muestra el código para entregar', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({
      ok: true,
      user_id: 'u9',
      membership_id: 'm9',
      rol: 'admin',
      estado: 'pendiente_invitacion',
      codigo_activacion: '135790',
      expira_en: '2026-08-07T10:00:00Z',
    } as never);

    await abrirFormYCompletar();
    fireEvent.click(screen.getByRole('button', { name: /Agregar a mi equipo/i }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/me/empresa/miembros', {
        full_name: 'Gabriel Barros',
        // El RUT viaja normalizado (sin puntos), como lo espera el backend.
        rut: '8601693-1',
        email: 'gobe00@gmail.com',
        rol: 'admin',
      }),
    );

    // El código queda a la vista para copiarlo y entregarlo.
    expect(await screen.findByText('135790')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Copiar código/i })).toBeInTheDocument();
  });

  it('explica que el código no es la contraseña de la persona', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({
      ok: true,
      user_id: 'u9',
      membership_id: 'm9',
      rol: 'admin',
      estado: 'pendiente_invitacion',
      codigo_activacion: '135790',
      expira_en: '2026-08-07T10:00:00Z',
    } as never);

    await abrirFormYCompletar();
    fireEvent.click(screen.getByRole('button', { name: /Agregar a mi equipo/i }));

    // Que quien lo entrega entienda qué está entregando: un código de un solo
    // uso, no una clave. La clave la elige la persona.
    expect(
      await screen.findByText(/elegirá su propia clave|define su propia clave/i),
    ).toBeInTheDocument();
  });

  it('avisa si esa persona ya es miembro', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(
      Object.assign(new Error('conflict'), { code: 'already_member', status: 409 }),
    );

    await abrirFormYCompletar();
    fireEvent.click(screen.getByRole('button', { name: /Agregar a mi equipo/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/ya (es|forma)/i));
  });

  it('avisa cuando el rol del usuario no permite gestionar el equipo', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(
      Object.assign(new Error('forbidden'), { code: 'rol_sin_permiso', status: 403 }),
    );

    await abrirFormYCompletar();
    fireEvent.click(screen.getByRole('button', { name: /Agregar a mi equipo/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/no tenés permiso|no tienes permiso/i),
    );
  });
});

describe('Equipo — validación del RUT antes de enviar', () => {
  it('un RUT con dígito verificador inválido se explica, sin llamar al API', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ miembros: [] });
    const post = vi.spyOn(api, 'post');
    render(<EquipoRoute />, { wrapper: makeWrapper() });
    await screen.findByText(/todavía no|aún no/i);

    fireEvent.click(screen.getByRole('button', { name: /Agregar persona/i }));
    fireEvent.change(screen.getByLabelText(/Nombre completo/i), {
      target: { value: 'Persona Prueba' },
    });
    // DV incorrecto: el de 17111222 es 2, no 3.
    fireEvent.change(screen.getByLabelText(/^RUT/i), { target: { value: '17111222-3' } });
    fireEvent.change(screen.getByLabelText(/Email/i), { target: { value: 'p@empresa.cl' } });
    fireEvent.click(screen.getByRole('button', { name: /Agregar a mi equipo/i }));

    // Un "400: API error 400" no le dice nada a quien está cargando gente.
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/RUT/i));
    expect(screen.getByRole('alert').textContent ?? '').not.toMatch(/API error/i);
    expect(post).not.toHaveBeenCalled();
  });
});
