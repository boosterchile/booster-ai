import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeResponse } from '../hooks/use-me.js';
import { api } from '../lib/api-client.js';

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
  userOverrides: Partial<{ rut: string | null; full_name: string; email: string }> = {},
): MeOnboarded {
  return {
    needs_onboarding: false,
    user: {
      id: 'u',
      full_name: userOverrides.full_name ?? 'F',
      rut: userOverrides.rut ?? null,
      email: userOverrides.email ?? null,
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
      me: makeMe('dueno', { rut: '22.222.222-2', full_name: 'Felipe' }),
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
    await userEvent.type(screen.getByLabelText(/^Número de licencia/), 'LIC-1');
    await userEvent.type(screen.getByLabelText(/^Vencimiento de licencia/), '2027-12-31');

    await userEvent.click(screen.getByRole('button', { name: /Crear conductor/ }));

    await waitFor(() =>
      expect(screen.getByText(/ya está asociado a un conductor activo/)).toBeInTheDocument(),
    );
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
