import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { esperarPendientesLimpios } from '../components/NombreMiembro.test-helper.js';
import type { MeResponse } from '../hooks/use-me.js';
import { ApiError, api } from '../lib/api-client.js';

/**
 * equipo-de-la-empresa Fase A — sección Equipo en la app del CLIENTE.
 *
 * La empresa gestiona su propia gente: Booster no interviene. Al dar de alta,
 * recibe un código de un solo uso para entregarle a la persona; esa persona
 * elige después su propia clave, así que el código no es una contraseña.
 */

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;

const ME: MeOnboarded = {
  needs_onboarding: false,
  user: {
    id: 'u1',
    email: 'duena@empresa.cl',
    full_name: 'Dueña Generadora',
    phone: null,
    whatsapp_e164: null,
    rut: '11111111-1',
    is_platform_admin: false,
    status: 'activo',
  },
  memberships: [],
  active_membership: {
    id: 'm1',
    role: 'dueno',
    status: 'activa',
    joined_at: null,
    empresa: {
      id: 'e1',
      legal_name: 'Retail Norte SpA',
      rut: '76274900-9',
      is_generador_carga: true,
      is_transportista: false,
      status: 'activa',
    },
  },
};

let providedContext: { kind: 'onboarded'; me: MeOnboarded } | { kind: 'unmanaged' } = {
  kind: 'onboarded',
  me: ME,
};
vi.mock('../components/ProtectedRoute.js', () => ({
  ProtectedRoute: ({ children }: { children: (ctx: unknown) => ReactNode }) => (
    <>{children(providedContext)}</>
  ),
}));

// acceso-usuarios-empresa-panel SC8: `/app/equipo` se muestra con el menú de la app.
vi.mock('../components/Layout.js', () => ({
  Layout: ({ children, title, me }: { children: ReactNode; title: string; me: MeOnboarded }) => (
    <main data-testid="layout" data-title={title} data-empresa={me.active_membership?.empresa?.id}>
      {children}
    </main>
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
    full_name: null,
    email: 'p***@empresa.cl',
    rut: '*****222-3',
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
  providedContext = { kind: 'onboarded', me: ME };
});

describe('Equipo — dentro del menú de la app (SC8)', () => {
  it('se muestra dentro del Layout, con el título Equipo', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ miembros: MIEMBROS });

    render(<EquipoRoute />, { wrapper: makeWrapper() });

    const layout = screen.getByTestId('layout');
    expect(layout).toHaveAttribute('data-title', 'Equipo');
    expect(layout).toHaveAttribute('data-empresa', 'e1');
    expect(await screen.findByText('Gabriel Barros')).toBeInTheDocument();
  });

  it('sin contexto de empresa no renderiza la página', () => {
    providedContext = { kind: 'unmanaged' };
    const get = vi.spyOn(api, 'get');

    render(<EquipoRoute />, { wrapper: makeWrapper() });

    expect(screen.queryByTestId('layout')).not.toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });
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

  it('un miembro pendiente se muestra sin nombre y con su estado', async () => {
    const pendiente = { ...MIEMBROS[1], pendiente_aceptar: true };
    vi.spyOn(api, 'get').mockResolvedValue({ miembros: [pendiente] });

    render(<EquipoRoute />, { wrapper: makeWrapper() });

    expect(await screen.findByText('Pendiente de aceptar')).toBeInTheDocument();
    await esperarPendientesLimpios();
    expect(screen.getByText('*****222-3')).toBeInTheDocument();
    expect(screen.queryByText('Marta Rojas')).toBeNull();
  });

  it('con equipo vacío explica qué hacer', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ miembros: [] });

    render(<EquipoRoute />, { wrapper: makeWrapper() });

    expect(await screen.findByText(/todavía no|aún no/i)).toBeInTheDocument();
  });
});

/**
 * capacidades-por-rol regla 7: dueño y admin editan en Equipo si un despachador
 * acepta ofertas. Las ofertas son de la transportista; en una generadora pura
 * el permiso no aplica y no se muestra.
 */
describe('Equipo — permiso «Puede aceptar ofertas»', () => {
  function meDe(
    role: 'dueno' | 'visualizador',
    tipo: { transportista: boolean; generador: boolean },
  ): MeOnboarded {
    const base = ME.active_membership;
    if (!base?.empresa) {
      throw new Error('ME sin empresa activa');
    }
    return {
      ...ME,
      active_membership: {
        ...base,
        role,
        empresa: {
          ...base.empresa,
          is_transportista: tipo.transportista,
          is_generador_carga: tipo.generador,
        },
      },
    };
  }

  it('en una generadora pura no se muestra junto al despachador', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ miembros: MIEMBROS });

    render(<EquipoRoute />, { wrapper: makeWrapper() });

    expect(await screen.findByText('Despachador')).toBeInTheDocument();
    expect(screen.queryByLabelText('Puede aceptar ofertas')).not.toBeInTheDocument();
  });

  it('en una transportista la dueña lo ve y al marcarlo se guarda', async () => {
    providedContext = {
      kind: 'onboarded',
      me: meDe('dueno', { transportista: true, generador: false }),
    };
    vi.spyOn(api, 'get').mockResolvedValue({ miembros: MIEMBROS });
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({ ok: true });

    render(<EquipoRoute />, { wrapper: makeWrapper() });

    const permiso = await screen.findByLabelText('Puede aceptar ofertas');
    expect(permiso).not.toBeChecked();
    fireEvent.click(permiso);
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/me/empresa/miembros/m2', {
        puede_aceptar_ofertas: true,
      }),
    );
  });

  it('en una empresa mixta la dueña lo ve', async () => {
    providedContext = {
      kind: 'onboarded',
      me: meDe('dueno', { transportista: true, generador: true }),
    };
    vi.spyOn(api, 'get').mockResolvedValue({ miembros: MIEMBROS });

    render(<EquipoRoute />, { wrapper: makeWrapper() });

    expect(await screen.findByLabelText('Puede aceptar ofertas')).toBeInTheDocument();
  });

  it('el visualizador de una transportista no lo ve', async () => {
    providedContext = {
      kind: 'onboarded',
      me: meDe('visualizador', { transportista: true, generador: false }),
    };
    vi.spyOn(api, 'get').mockResolvedValue({ miembros: MIEMBROS });

    render(<EquipoRoute />, { wrapper: makeWrapper() });

    expect(await screen.findByText('Despachador')).toBeInTheDocument();
    expect(screen.queryByLabelText('Puede aceptar ofertas')).not.toBeInTheDocument();
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

  it('alta de RUT existente muestra la solicitud registrada, sin código ni textos anteriores', async () => {
    vi.spyOn(api, 'post').mockResolvedValue({
      ok: true,
      user_id: 'u9',
      membership_id: 'm9',
      rol: 'admin',
      estado: 'pendiente_invitacion',
      codigo_activacion: null,
      expira_en: null,
      vinculo: 'codigo_vigente',
    } as never);

    await abrirFormYCompletar();
    fireEvent.click(screen.getByRole('button', { name: /Agregar a mi equipo/i }));

    expect(await screen.findByText('Solicitud registrada')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Se sumará a tu equipo cuando acepte. Pronto podrá hacerlo desde Booster; por ahora, avísale tú.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Volver a Equipo' })).toBeInTheDocument();
    for (const viejo of [/ya tiene cuenta/i, /ya tiene un código/i, /quedará en/i]) {
      expect(screen.queryByText(viejo)).not.toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: /Copiar código/i })).not.toBeInTheDocument();
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

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/no tienes permiso/i));
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

describe('Equipo — 400 del servidor bajo cada campo (TRK-005)', () => {
  const rechazo400 = (issues: { path: string[]; message: string }[]) =>
    vi.spyOn(api, 'post').mockRejectedValue(
      new ApiError(400, 'validation_error', {
        success: false,
        error: { issues, name: 'ZodError' },
      }),
    );
  async function enviar() {
    vi.spyOn(api, 'get').mockResolvedValue({ miembros: [] });
    render(<EquipoRoute />, { wrapper: makeWrapper() });
    await screen.findByText(/todavía no|aún no/i);
    fireEvent.click(screen.getByRole('button', { name: /Agregar persona/i }));
    fireEvent.change(screen.getByLabelText(/Nombre completo/i), { target: { value: 'Ana Pérez' } });
    fireEvent.change(screen.getByLabelText(/^RUT/i), { target: { value: '8.601.693-1' } });
    fireEvent.change(screen.getByLabelText(/Email/i), { target: { value: 'ana@empresa.cl' } });
    fireEvent.click(screen.getByRole('button', { name: /Agregar a mi equipo/i }));
    return (await screen.findAllByRole('alert'))[0] as HTMLElement;
  }

  it('muestra el mensaje del campo, sin "400:" ni "email:", uno por campo', async () => {
    rechazo400([
      { path: ['email'], message: 'Ingresa un correo válido' },
      { path: ['email'], message: 'Usa como máximo 255 caracteres' },
    ]);
    const alerta = await enviar();
    expect(alerta).toHaveTextContent(/^Ingresa un correo válido$/);
    expect(screen.getByLabelText(/Email/i).closest('label')).toContainElement(alerta);
    expect(screen.queryByText(/Usa como máximo/)).not.toBeInTheDocument();
  });

  it('un issue sin texto en español muestra el genérico', async () => {
    rechazo400([{ path: ['rol'], message: 'Invalid option: expected one of "admin"' }]);
    expect(await enviar()).toHaveTextContent('Algo salió mal. Intenta de nuevo');
  });

  const rechazo = (status: number, code: string, details: unknown = {}) =>
    vi.spyOn(api, 'post').mockRejectedValue(new ApiError(status, code, details));

  it('409 rut_already_registered → texto propio, no el genérico', async () => {
    rechazo(409, 'rut_already_registered');
    expect(await enviar()).toHaveTextContent(
      'Ese RUT ya está registrado en Booster con otro correo. Revisa el RUT o escribe a soporte.',
    );
  });

  it('403 no_es_empresa → genérico', async () => {
    rechazo(403, 'no_es_empresa');
    expect(await enviar()).toHaveTextContent('Algo salió mal. Intenta de nuevo');
  });

  it('path anidado va a su campo raíz y un issue sin campo suma el genérico arriba', async () => {
    rechazo400([
      { path: ['email', 'dominio'], message: 'Ingresa un correo válido' },
      { path: [], message: 'Revisa los datos' },
    ]);
    await enviar();
    const textos = (await screen.findAllByRole('alert')).map((a) => a.textContent);
    expect(textos).toEqual(['Ingresa un correo válido', 'Algo salió mal. Intenta de nuevo']);
    expect(screen.getByLabelText(/Email/i)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(/Email/i)).toHaveAttribute('aria-describedby', 'alta-err-email');
  });
});
