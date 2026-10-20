import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeResponse } from '../hooks/use-me.js';
import { ApiError, api } from '../lib/api-client.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;
type Ctx = { kind: 'onboarded'; me: MeOnboarded } | { kind: 'unmanaged' };
let providedContext: Ctx = { kind: 'unmanaged' };

vi.mock('../components/ProtectedRoute.js', () => ({
  ProtectedRoute: ({ children }: { children: (ctx: Ctx) => ReactNode }) => (
    <>{children(providedContext)}</>
  ),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
  useNavigate: () => vi.fn(),
  useParams: () => ({ id: 'c-1' }),
}));

vi.mock('../components/Layout.js', () => ({
  Layout: ({ children, title }: { children: ReactNode; title: string }) => (
    <div data-testid="layout" data-title={title}>
      {children}
    </div>
  ),
}));

const { ConductoresListRoute, ConductoresNuevoRoute, ConductoresDetalleRoute } = await import(
  './conductores.js'
);

function makeMe(
  role: 'dueno' | 'admin' | 'despachador' | 'conductor' = 'dueno',
  userOverrides: Partial<{
    rut: string | null;
    full_name: string;
    email: string;
    phone: string;
  }> = {},
): MeOnboarded {
  return {
    needs_onboarding: false,
    user: {
      id: 'u',
      full_name: userOverrides.full_name ?? 'F',
      rut: userOverrides.rut ?? null,
      email: userOverrides.email ?? null,
      phone: userOverrides.phone ?? null,
    } as unknown as MeOnboarded['user'],
    memberships: [],
    active_membership: {
      id: 'm',
      role,
      status: 'activa',
      joined_at: null,
      empresa: {
        id: 'e',
        legal_name: 'Transportes Demo',
        rut: '76.123.456-7',
        is_generador_carga: false,
        is_transportista: true,
        status: 'activa',
      },
    } as MeOnboarded['active_membership'],
  } as MeOnboarded;
}

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

function buildConductor(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'c-1',
    user_id: 'u-1',
    empresa_id: 'e',
    license_class: 'A5',
    license_number: 'LIC-12345',
    license_expiry: '2027-12-31',
    is_extranjero: false,
    status: 'activo',
    created_at: '2026-05-10T22:00:00Z',
    updated_at: '2026-05-10T22:00:00Z',
    deleted_at: null,
    user: {
      id: 'u-1',
      full_name: 'Juan Pérez',
      rut: '11.111.111-1',
      email: 'juan@example.com',
      phone: '+56912345678',
      is_pending: false,
    },
    ...overrides,
  };
}

// jsdom no implementa scrollIntoView. El hook useScrollToFirstError lo llama
// al submit con errores; sin stub el test passa pero vitest reporta error.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
  providedContext = { kind: 'unmanaged' };
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('ConductoresListRoute', () => {
  it('lista vacía → empty state', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({ conductores: [] });
    providedContext = { kind: 'onboarded', me: makeMe() };
    wrap(<ConductoresListRoute />);
    await waitFor(() => expect(screen.getByText(/Aún no tienes conductores/)).toBeInTheDocument());
  });

  it('lista con conductor activo → muestra nombre, RUT, licencia y estado', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({ conductores: [buildConductor()] });
    providedContext = { kind: 'onboarded', me: makeMe() };
    wrap(<ConductoresListRoute />);
    await waitFor(() => expect(screen.getAllByText('Juan Pérez')[0]).toBeInTheDocument());
    expect(screen.getAllByText('11.111.111-1')[0]).toBeInTheDocument();
    expect(screen.getAllByText('A5')[0]).toBeInTheDocument();
    expect(screen.getAllByText('Activo')[0]).toBeInTheDocument();
  });

  it('conductor con user pendiente → muestra badge "Pendiente login"', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      conductores: [
        buildConductor({
          user: {
            id: 'u-1',
            full_name: 'Juan',
            rut: '11.111.111-1',
            email: 'pending@boosterchile.invalid',
            phone: null,
            is_pending: true,
          },
        }),
      ],
    });
    providedContext = { kind: 'onboarded', me: makeMe() };
    wrap(<ConductoresListRoute />);
    await waitFor(() => expect(screen.getAllByText(/Pendiente login/)[0]).toBeInTheDocument());
  });

  it('conductor extranjero → muestra badge', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      conductores: [buildConductor({ is_extranjero: true })],
    });
    providedContext = { kind: 'onboarded', me: makeMe() };
    wrap(<ConductoresListRoute />);
    await waitFor(() => expect(screen.getAllByText('Extranjero')[0]).toBeInTheDocument());
  });

  it('licencia vencida → muestra badge "Vencida"', async () => {
    // Una fecha claramente en el pasado.
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      conductores: [buildConductor({ license_expiry: '2020-01-01' })],
    });
    providedContext = { kind: 'onboarded', me: makeMe() };
    wrap(<ConductoresListRoute />);
    await waitFor(() => expect(screen.getAllByText(/Vencida/)[0]).toBeInTheDocument());
  });

  it('rol conductor no ve botón "Nuevo conductor"', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({ conductores: [] });
    providedContext = { kind: 'onboarded', me: makeMe('conductor') };
    wrap(<ConductoresListRoute />);
    await waitFor(() => expect(screen.getByText(/Aún no tienes conductores/)).toBeInTheDocument());
    expect(screen.queryByText('Nuevo conductor')).toBeNull();
  });
});

describe('ConductoresNuevoRoute', () => {
  it('conductor → bloqueo NoPermission', () => {
    providedContext = { kind: 'onboarded', me: makeMe('conductor') };
    wrap(<ConductoresNuevoRoute />);
    expect(screen.getByText('Sin permisos')).toBeInTheDocument();
  });

  it('submit con RUT inválido → no llama API, muestra error', async () => {
    const postSpy = vi.spyOn(api, 'post');
    providedContext = { kind: 'onboarded', me: makeMe('despachador') };
    wrap(<ConductoresNuevoRoute />);

    await userEvent.type(screen.getByLabelText(/^RUT/), '11.111.111-9');
    await userEvent.type(screen.getByLabelText(/^Nombre completo/), 'Juan');
    await userEvent.type(screen.getByLabelText(/^Teléfono/), '+56957790379');
    await userEvent.type(screen.getByLabelText(/^Email/), 'juan@empresa.cl');
    await userEvent.type(screen.getByLabelText(/^Número de licencia/), 'LIC-1');
    // Date input
    const dateInput = screen.getByLabelText(/^Vencimiento de licencia/);
    await userEvent.type(dateInput, '2027-12-31');

    await userEvent.click(screen.getByRole('button', { name: /Crear conductor/ }));

    // El RUT con dígito verificador incorrecto debería bloquear submit.
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('mutation success → invalida queries y navega', async () => {
    vi.spyOn(api, 'post').mockResolvedValueOnce({
      conductor: buildConductor(),
      activation_pin: '123456',
    });
    providedContext = { kind: 'onboarded', me: makeMe('despachador') };
    wrap(<ConductoresNuevoRoute />);

    await userEvent.type(screen.getByLabelText(/^RUT/), '11.111.111-1');
    await userEvent.type(screen.getByLabelText(/^Nombre completo/), 'Juan Pérez');
    await userEvent.type(screen.getByLabelText(/^Teléfono/), '+56957790379');
    // Fase B: el email del conductor es obligatorio.
    await userEvent.type(screen.getByLabelText(/^Email/), 'juan@empresa.cl');
    await userEvent.type(screen.getByLabelText(/^Número de licencia/), 'LIC-1');
    const dateInput = screen.getByLabelText(/^Vencimiento de licencia/);
    await userEvent.type(dateInput, '2027-12-31');

    await userEvent.click(screen.getByRole('button', { name: /Crear conductor/ }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
  });

  it('D10 — self-mode toggle prellena RUT del dueño', async () => {
    providedContext = {
      kind: 'onboarded',
      me: makeMe('dueno', {
        rut: '22.222.222-2',
        full_name: 'Felipe Vicencio',
        email: 'felipe@example.cl',
      }),
    };
    wrap(<ConductoresNuevoRoute />);

    const toggle = screen.getByTestId('self-mode-toggle');
    await userEvent.click(toggle);

    expect(screen.getByLabelText(/^RUT/)).toHaveValue('22.222.222-2');
    expect(screen.getByLabelText(/^Nombre completo/)).toHaveValue('Felipe Vicencio');
  });

  it('D10 — sin RUT en el me no muestra el toggle (precondición)', () => {
    providedContext = {
      kind: 'onboarded',
      me: makeMe('dueno', { rut: null }),
    };
    wrap(<ConductoresNuevoRoute />);
    expect(screen.queryByTestId('self-mode-toggle')).toBeNull();
  });

  it('D10 — success sin activation_pin → navega directo a la lista', async () => {
    vi.spyOn(api, 'post').mockResolvedValueOnce({
      conductor: buildConductor(),
      // sin activation_pin (dueño-conductor)
    });
    providedContext = {
      kind: 'onboarded',
      // Fase B: el email es obligatorio, así que el dueño-conductor también
      // necesita el suyo — el toggle self-mode lo prellena desde el `me`.
      // El teléfono también se prellena desde el `me` desde que es
      // obligatorio: el dueño no debería tipear un dato que ya tenemos.
      me: makeMe('dueno', {
        rut: '22.222.222-2',
        full_name: 'Felipe',
        email: 'felipe@empresa.cl',
        phone: '+56957790379',
      }),
    };
    wrap(<ConductoresNuevoRoute />);

    await userEvent.click(screen.getByTestId('self-mode-toggle'));
    await userEvent.type(screen.getByLabelText(/^Número de licencia/), 'LIC-1');
    await userEvent.type(screen.getByLabelText(/^Vencimiento de licencia/), '2027-12-31');
    await userEvent.click(screen.getByRole('button', { name: /Crear conductor/ }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    // No debe mostrar la card de PIN
    expect(screen.queryByText(/PIN de activación/)).toBeNull();
  });

  it('error user_already_driver → muestra mensaje específico', async () => {
    vi.spyOn(api, 'post').mockRejectedValueOnce(new Error('user_already_driver'));
    providedContext = { kind: 'onboarded', me: makeMe('despachador') };
    wrap(<ConductoresNuevoRoute />);

    await userEvent.type(screen.getByLabelText(/^RUT/), '11.111.111-1');
    await userEvent.type(screen.getByLabelText(/^Nombre completo/), 'Juan');
    await userEvent.type(screen.getByLabelText(/^Teléfono/), '+56957790379');
    await userEvent.type(screen.getByLabelText(/^Email/), 'juan@empresa.cl');
    await userEvent.type(screen.getByLabelText(/^Número de licencia/), 'LIC-1');
    await userEvent.type(screen.getByLabelText(/^Vencimiento de licencia/), '2027-12-31');

    await userEvent.click(screen.getByRole('button', { name: /Crear conductor/ }));

    await waitFor(() =>
      expect(screen.getByText(/ya está asociado a un conductor activo/)).toBeInTheDocument(),
    );
  });

  async function enviarAlta() {
    await userEvent.type(screen.getByLabelText(/^RUT/), '11.111.111-1');
    await userEvent.type(screen.getByLabelText(/^Nombre completo/), 'Juan Pérez');
    await userEvent.type(screen.getByLabelText(/^Teléfono/), '+56957790379');
    await userEvent.type(screen.getByLabelText(/^Email/), 'juan@empresa.cl');
    await userEvent.type(screen.getByLabelText(/^Número de licencia/), 'LIC-1');
    await userEvent.type(screen.getByLabelText(/^Vencimiento de licencia/), '2027-12-31');
    await userEvent.click(screen.getByRole('button', { name: /Crear conductor/ }));
  }

  it('reactivado con PIN → muestra el PIN igual que un alta', async () => {
    vi.spyOn(api, 'post').mockResolvedValueOnce({
      conductor: buildConductor(),
      activation_pin: '654321',
      reactivado: true,
    });
    providedContext = { kind: 'onboarded', me: makeMe('despachador') };
    wrap(<ConductoresNuevoRoute />);
    await enviarAlta();

    expect(await screen.findByText('654321')).toBeInTheDocument();
    expect(screen.getByText(/PIN de activación/)).toBeInTheDocument();
    expect(screen.getByTestId('layout')).toHaveAttribute('data-title', 'Conductor reactivado');
  });

  it('error duplicate → mensaje en español, no el código crudo', async () => {
    vi.spyOn(api, 'post').mockRejectedValueOnce(
      new ApiError(409, 'duplicate', { code: 'duplicate', error: 'duplicate' }, 'duplicate'),
    );
    providedContext = { kind: 'onboarded', me: makeMe('despachador') };
    wrap(<ConductoresNuevoRoute />);
    await enviarAlta();

    expect(await screen.findByText(/vuelve a intentar el alta/)).toBeInTheDocument();
    expect(screen.queryByText('duplicate')).toBeNull();
  });

  it('error conductor_retirado_otra_empresa → explica que no se puede reactivar', async () => {
    vi.spyOn(api, 'post').mockRejectedValueOnce(
      new ApiError(
        409,
        'conductor_retirado_otra_empresa',
        { code: 'conductor_retirado_otra_empresa' },
        'API error 409 (conductor_retirado_otra_empresa)',
      ),
    );
    providedContext = { kind: 'onboarded', me: makeMe('despachador') };
    wrap(<ConductoresNuevoRoute />);
    await enviarAlta();

    expect(await screen.findByText(/retirado de otra empresa/)).toBeInTheDocument();
    expect(screen.queryByText(/conductor_retirado_otra_empresa/)).toBeNull();
  });

  it('error identidad_vinculada en el alta → explica el vínculo y no muestra PIN', async () => {
    vi.spyOn(api, 'post').mockRejectedValueOnce(new Error('identidad_vinculada'));
    providedContext = { kind: 'onboarded', me: makeMe('despachador') };
    wrap(<ConductoresNuevoRoute />);
    await enviarAlta();

    expect(await screen.findByText(/otra empresa o tiene otro rol/)).toBeInTheDocument();
    expect(screen.queryByText(/PIN de activación/)).toBeNull();
  });
});

describe('ConductoresDetalleRoute', () => {
  it('renderiza datos del conductor + form de edición', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({ conductor: buildConductor() });
    providedContext = { kind: 'onboarded', me: makeMe('admin') };
    wrap(<ConductoresDetalleRoute />);
    await waitFor(() => expect(screen.getByText('Juan Pérez')).toBeInTheDocument());
    expect(screen.getByText('11.111.111-1')).toBeInTheDocument();
    expect(screen.getByText('juan@example.com')).toBeInTheDocument();
  });

  it('el rol conductor no puede cambiar el email', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ conductor: buildConductor() });
    providedContext = { kind: 'onboarded', me: makeMe('conductor') };
    wrap(<ConductoresDetalleRoute />);
    await screen.findByText('Juan Pérez');
    expect(screen.queryByRole('button', { name: /Guardar email/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Guardar teléfono/ })).toBeNull();
  });

  it('pendiente con email de relleno: guarda el real y muestra el PIN reenviado', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      conductor: buildConductor({
        user: {
          id: 'u-1',
          full_name: 'Camila Rojas',
          rut: '11.111.111-1',
          email: 'pending-rut-111111111@boosterchile.invalid',
          phone: null,
          is_pending: true,
        },
      }),
    });
    const post = vi.spyOn(api, 'post').mockResolvedValue({
      email: 'usuario@example.com',
      invitacion_reenviada: true,
      cuenta_activa: false,
      activation_pin: '482915',
    });
    providedContext = { kind: 'onboarded', me: makeMe('despachador') };
    wrap(<ConductoresDetalleRoute />);
    expect(await screen.findByText(/email de relleno/i)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Email de contacto/), 'usuario@example.com');
    await userEvent.click(
      screen.getByRole('button', { name: /Guardar email y reenviar invitación/ }),
    );
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/conductores/c-1/email', {
        email: 'usuario@example.com',
      }),
    );
    expect(await screen.findByText('482915')).toBeInTheDocument();
  });

  it('email vacío o sin TLD: el reenvío queda deshabilitado y avisa en la ficha', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      conductor: buildConductor({
        user: {
          id: 'u-1',
          full_name: 'Camila Rojas',
          rut: '11.111.111-1',
          email: 'pending-rut-111111111@boosterchile.invalid',
          phone: null,
          is_pending: true,
        },
      }),
    });
    const post = vi.spyOn(api, 'post');
    providedContext = { kind: 'onboarded', me: makeMe('despachador') };
    wrap(<ConductoresDetalleRoute />);
    const boton = await screen.findByRole('button', {
      name: /Guardar email y reenviar invitación/,
    });
    expect(boton).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/Email de contacto/), 'a@b');
    expect(
      await screen.findByText(/Escribe un email válido, como nombre@dominio.cl/),
    ).toBeInTheDocument();
    expect(boton).toBeDisabled();
    expect(post).not.toHaveBeenCalled();
  });

  it('persona vinculada a otra empresa: explica el bloqueo y no muestra PIN', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      conductor: buildConductor({
        user: {
          id: 'u-1',
          full_name: 'Camila Rojas',
          rut: '11.111.111-1',
          email: 'pending-rut-111111111@boosterchile.invalid',
          phone: null,
          is_pending: true,
        },
      }),
    });
    vi.spyOn(api, 'post').mockRejectedValueOnce(new Error('identidad_vinculada'));
    providedContext = { kind: 'onboarded', me: makeMe('despachador') };
    wrap(<ConductoresDetalleRoute />);
    await userEvent.type(await screen.findByLabelText(/Email de contacto/), 'usuario@example.com');
    await userEvent.click(
      screen.getByRole('button', { name: /Guardar email y reenviar invitación/ }),
    );
    expect(await screen.findByText(/otra empresa o tiene otro rol/i)).toBeInTheDocument();
    expect(screen.queryByText('482915')).toBeNull();
  });

  it('teléfono inválido deshabilita el reenvío y muestra el aviso', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ conductor: buildConductor() });
    const post = vi.spyOn(api, 'post');
    providedContext = { kind: 'onboarded', me: makeMe('despachador') };
    wrap(<ConductoresDetalleRoute />);
    const input = await screen.findByLabelText(/Teléfono \(WhatsApp\)/);
    expect(input).toHaveAttribute('placeholder', '+56912345678');
    await userEvent.clear(input);
    await userEvent.type(input, '+569');
    expect(screen.getByText('Ingresa un teléfono válido (+569...)')).toBeInTheDocument();
    const boton = screen.getByRole('button', { name: 'Guardar teléfono y reenviar invitación' });
    expect(boton).toBeDisabled();
    expect(post).not.toHaveBeenCalled();
  });

  it('un fijo +562 no habilita el reenvío y usa el mismo aviso', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ conductor: buildConductor() });
    const post = vi.spyOn(api, 'post');
    providedContext = { kind: 'onboarded', me: makeMe('despachador') };
    wrap(<ConductoresDetalleRoute />);
    const input = await screen.findByLabelText(/Teléfono \(WhatsApp\)/);
    await userEvent.clear(input);
    await userEvent.type(input, '+56212345678');
    expect(screen.getByText('Ingresa un teléfono válido (+569...)')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Guardar teléfono y reenviar invitación' }),
    ).toBeDisabled();
    expect(post).not.toHaveBeenCalled();
  });

  it('guarda el teléfono, muestra el PIN nuevo y actualiza el encabezado', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({
      conductor: buildConductor({
        user: {
          id: 'u-1',
          full_name: 'Juan Pérez',
          rut: '11.111.111-1',
          email: 'viejo@example.com',
          phone: '+56911111111',
          is_pending: true,
        },
      }),
    });
    const post = vi.spyOn(api, 'post').mockResolvedValue({
      phone: '+56987654321',
      email: 'juan@example.com',
      invitacion_reenviada: true,
      cuenta_activa: false,
      activation_pin: '135790',
    });
    providedContext = { kind: 'onboarded', me: makeMe('admin') };
    wrap(<ConductoresDetalleRoute />);
    expect(await screen.findByText('viejo@example.com')).toBeInTheDocument();
    expect(screen.getByText('+56911111111')).toBeInTheDocument();
    const input = screen.getByLabelText(/Teléfono \(WhatsApp\)/);
    await userEvent.clear(input);
    await userEvent.type(input, '+56987654321');
    await userEvent.click(
      screen.getByRole('button', { name: 'Guardar teléfono y reenviar invitación' }),
    );
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/conductores/c-1/telefono', {
        phone: '+56987654321',
      }),
    );
    expect(await screen.findByText('135790')).toBeInTheDocument();
    expect(screen.getByText('+56987654321')).toBeInTheDocument();
    expect(screen.getByText('juan@example.com')).toBeInTheDocument();
    expect(screen.queryByText('viejo@example.com')).toBeNull();
    expect(screen.queryByText('+56911111111')).toBeNull();
  });

  it('conductor retirado (deleted_at) → form disabled + banner', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      conductor: buildConductor({ deleted_at: '2026-05-09T10:00:00Z' }),
    });
    providedContext = { kind: 'onboarded', me: makeMe('admin') };
    wrap(<ConductoresDetalleRoute />);
    await waitFor(() =>
      expect(screen.getByText(/Conductor retirado el 2026-05-09/)).toBeInTheDocument(),
    );
  });
});

// ---------------------------------------------------------------------------
// equipo-de-la-empresa Fase B — el conductor tiene email real
// ---------------------------------------------------------------------------
// Medido en prod el 2026-07-31: 5 de 6 conductores quedaron con un correo
// `@boosterchile.invalid` porque el campo era opcional. Son personas a las que
// la plataforma no puede escribirle.
describe('ConductoresNuevoRoute — email obligatorio (Fase B)', () => {
  it('no permite crear un conductor sin email', async () => {
    const post = vi.spyOn(api, 'post');
    providedContext = { kind: 'onboarded', me: makeMe('despachador') };
    wrap(<ConductoresNuevoRoute />);

    await userEvent.type(screen.getByLabelText(/^RUT/), '11.111.111-1');
    await userEvent.type(screen.getByLabelText(/^Nombre completo/), 'Juan Pérez');
    await userEvent.type(screen.getByLabelText(/^Teléfono/), '+56957790379');
    await userEvent.type(screen.getByLabelText(/^Número de licencia/), 'LIC-1');
    await userEvent.type(screen.getByLabelText(/^Vencimiento de licencia/), '2027-12-31');
    // A propósito SIN email: el botón no se habilita.
    expect(screen.getByRole('button', { name: /Crear conductor/ })).toBeDisabled();
    expect(post).not.toHaveBeenCalled();
  });

  it('envía el email en el body cuando se completa', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValueOnce({
      conductor: buildConductor(),
      activation_pin: '123456',
    });
    providedContext = { kind: 'onboarded', me: makeMe('despachador') };
    wrap(<ConductoresNuevoRoute />);

    await userEvent.type(screen.getByLabelText(/^RUT/), '11.111.111-1');
    await userEvent.type(screen.getByLabelText(/^Nombre completo/), 'Juan Pérez');
    await userEvent.type(screen.getByLabelText(/^Teléfono/), '+56957790379');
    await userEvent.type(screen.getByLabelText(/^Email/), 'juan@empresa.cl');
    await userEvent.type(screen.getByLabelText(/^Número de licencia/), 'LIC-1');
    await userEvent.type(screen.getByLabelText(/^Vencimiento de licencia/), '2027-12-31');
    await userEvent.click(screen.getByRole('button', { name: /Crear conductor/ }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const body = post.mock.calls[0]?.[1] as { email?: string };
    expect(body.email).toBe('juan@empresa.cl');
  });

  it('no envía un email de relleno', async () => {
    const post = vi.spyOn(api, 'post');
    providedContext = { kind: 'onboarded', me: makeMe('despachador') };
    wrap(<ConductoresNuevoRoute />);

    await userEvent.type(screen.getByLabelText(/^RUT/), '11.111.111-1');
    await userEvent.type(screen.getByLabelText(/^Nombre completo/), 'Juan Pérez');
    await userEvent.type(screen.getByLabelText(/^Teléfono/), '+56957790379');
    await userEvent.type(
      screen.getByLabelText(/^Email/),
      'pending-rut-111111111@boosterchile.invalid',
    );
    await userEvent.type(screen.getByLabelText(/^Número de licencia/), 'LIC-1');
    await userEvent.type(screen.getByLabelText(/^Vencimiento de licencia/), '2027-12-31');

    expect(await screen.findByText(/email real del conductor/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Crear conductor/ })).toBeDisabled();
    expect(post).not.toHaveBeenCalled();
  });

  it('«abc» y «a@b» muestran el mensaje y dejan el alta deshabilitada', async () => {
    const post = vi.spyOn(api, 'post');
    providedContext = { kind: 'onboarded', me: makeMe('despachador') };
    wrap(<ConductoresNuevoRoute />);

    await userEvent.type(screen.getByLabelText(/^RUT/), '11.111.111-1');
    await userEvent.type(screen.getByLabelText(/^Nombre completo/), 'Juan Pérez');
    await userEvent.type(screen.getByLabelText(/^Teléfono/), '+56957790379');
    await userEvent.type(screen.getByLabelText(/^Número de licencia/), 'LIC-1');
    await userEvent.type(screen.getByLabelText(/^Vencimiento de licencia/), '2027-12-31');
    await userEvent.type(screen.getByLabelText(/^Email/), 'abc');

    expect(
      await screen.findByText(/Escribe un email válido, como nombre@dominio.cl/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Crear conductor/ })).toBeDisabled();

    await userEvent.clear(screen.getByLabelText(/^Email/));
    await userEvent.type(screen.getByLabelText(/^Email/), 'a@b');
    expect(screen.getByText(/Escribe un email válido, como nombre@dominio.cl/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Crear conductor/ })).toBeDisabled();
    expect(post).not.toHaveBeenCalled();
  });
});

/**
 * Tras dar de alta, la empresa tiene que poder ENTREGARLE algo al conductor.
 *
 * La pantalla mencionaba `/login/conductor` como texto plano, sin dominio y
 * sin ser clickeable: imposible de copiar y mandar por WhatsApp. Mientras el
 * correo automático no esté activo (falta la key de Resend), esto es lo único
 * que tiene la empresa para que el conductor llegue a activarse.
 */
describe('ConductoresNuevoRoute — el alta entrega un enlace usable', () => {
  it('muestra el enlace de activación completo, con el RUT, y se puede copiar', async () => {
    vi.spyOn(api, 'post').mockResolvedValueOnce({
      conductor: buildConductor(),
      activation_pin: '123456',
    });
    providedContext = { kind: 'onboarded', me: makeMe('despachador') };
    wrap(<ConductoresNuevoRoute />);

    await userEvent.type(screen.getByLabelText(/^RUT/), '5.864.136-7');
    await userEvent.type(screen.getByLabelText(/^Nombre completo/), 'Javier Poblete');
    await userEvent.type(screen.getByLabelText(/^Teléfono/), '+56957790379');
    await userEvent.type(screen.getByLabelText(/^Email/), 'fvp@live.cl');
    await userEvent.type(screen.getByLabelText(/^Número de licencia/), 'LIC-1');
    await userEvent.type(screen.getByLabelText(/^Vencimiento de licencia/), '2027-12-31');
    await userEvent.click(screen.getByRole('button', { name: /Crear conductor/ }));

    const enlace = await screen.findByTestId('enlace-activacion-conductor');
    const href = enlace.getAttribute('href') ?? '';
    // Absoluto: la empresa lo copia y lo manda; un path relativo no sirve.
    expect(href).toMatch(/^https?:\/\//);
    expect(href).toContain('/login/conductor');
    expect(href).toContain('rut=5864136-7');

    expect(screen.getByTestId('copiar-enlace-activacion')).toBeInTheDocument();
  });
});

/**
 * Teléfono obligatorio — WhatsApp es el canal principal.
 *
 * Decisión del PO (2026-08-03): «hazlo obligatorio, whatsapp va a ser el canal
 * principal». Medido en prod: 2 de 7 conductores quedaron sin número, o sea
 * inalcanzables por el canal que más van a usar.
 */
describe('ConductoresNuevoRoute — teléfono obligatorio (canal WhatsApp)', () => {
  it('no permite crear un conductor sin teléfono', async () => {
    const post = vi.spyOn(api, 'post');
    providedContext = { kind: 'onboarded', me: makeMe('despachador') };
    wrap(<ConductoresNuevoRoute />);

    await userEvent.type(screen.getByLabelText(/^RUT/), '5.864.136-7');
    await userEvent.type(screen.getByLabelText(/^Nombre completo/), 'Javier Poblete');
    await userEvent.type(screen.getByLabelText(/^Email/), 'fvp@live.cl');
    await userEvent.type(screen.getByLabelText(/^Número de licencia/), 'LIC-1');
    await userEvent.type(screen.getByLabelText(/^Vencimiento de licencia/), '2027-12-31');
    // A propósito SIN teléfono: el botón no se habilita.
    expect(screen.getByRole('button', { name: /Crear conductor/ })).toBeDisabled();
    expect(post).not.toHaveBeenCalled();
  });

  it('el label ya no dice "opcional" y explica para qué se usa', () => {
    providedContext = { kind: 'onboarded', me: makeMe('despachador') };
    wrap(<ConductoresNuevoRoute />);
    const label = screen.getByLabelText(/^Teléfono/);
    expect(label).toBeInTheDocument();
    expect(screen.queryByLabelText(/Teléfono \(opcional\)/)).not.toBeInTheDocument();
    expect(screen.getByText(/WhatsApp/i)).toBeInTheDocument();
  });

  it('un fijo +562 no habilita el alta y muestra el mismo aviso', async () => {
    const post = vi.spyOn(api, 'post');
    providedContext = { kind: 'onboarded', me: makeMe('despachador') };
    wrap(<ConductoresNuevoRoute />);

    await userEvent.type(screen.getByLabelText(/^RUT/), '11.111.111-1');
    await userEvent.type(screen.getByLabelText(/^Nombre completo/), 'Juan Pérez');
    await userEvent.type(screen.getByLabelText(/^Teléfono/), '+56221234567');
    await userEvent.type(screen.getByLabelText(/^Email/), 'juan@example.com');
    await userEvent.type(screen.getByLabelText(/^Número de licencia/), 'LIC-1');
    await userEvent.type(screen.getByLabelText(/^Vencimiento de licencia/), '2027-12-31');

    expect(screen.getByText('Ingresa un teléfono válido (+569...)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Crear conductor/ })).toBeDisabled();
    expect(post).not.toHaveBeenCalled();
  });

  it('manda el teléfono en el body', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValueOnce({
      conductor: buildConductor(),
      activation_pin: '123456',
    });
    providedContext = { kind: 'onboarded', me: makeMe('despachador') };
    wrap(<ConductoresNuevoRoute />);

    await userEvent.type(screen.getByLabelText(/^RUT/), '5.864.136-7');
    await userEvent.type(screen.getByLabelText(/^Nombre completo/), 'Javier Poblete');
    await userEvent.type(screen.getByLabelText(/^Teléfono/), '+56957790379');
    await userEvent.type(screen.getByLabelText(/^Email/), 'fvp@live.cl');
    await userEvent.type(screen.getByLabelText(/^Número de licencia/), 'LIC-1');
    await userEvent.type(screen.getByLabelText(/^Vencimiento de licencia/), '2027-12-31');
    await userEvent.click(screen.getByRole('button', { name: /Crear conductor/ }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect((post.mock.calls[0]?.[1] as { phone?: string }).phone).toBe('+56957790379');
  });
});
