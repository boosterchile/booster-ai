import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  useParams: () => ({ id: 's-1' }),
}));

vi.mock('../components/Layout.js', () => ({
  Layout: ({ children, title }: { children: ReactNode; title: string }) => (
    <div data-testid="layout" data-title={title}>
      {children}
    </div>
  ),
}));

const { SucursalesListRoute, SucursalesNuevaRoute, SucursalesDetalleRoute } = await import(
  './sucursales.js'
);

function makeMe(role: 'dueno' | 'admin' | 'despachador' | 'conductor' = 'dueno'): MeOnboarded {
  return {
    needs_onboarding: false,
    user: { id: 'u', full_name: 'F' } as MeOnboarded['user'],
    memberships: [],
    active_membership: {
      id: 'm',
      role,
      status: 'activa',
      joined_at: null,
      empresa: {
        id: 'e',
        legal_name: 'Andina Demo',
        rut: '76.111.222-3',
        is_generador_carga: true,
        is_transportista: false,
        status: 'activa',
      },
    } as MeOnboarded['active_membership'],
  } as MeOnboarded;
}

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

function buildSucursal(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 's-1',
    empresa_id: 'e',
    nombre: 'Bodega Maipú',
    address_street: 'Av. Pajaritos 1234',
    address_city: 'Maipú',
    address_region: 'XIII',
    latitude: -33.5111,
    longitude: -70.7575,
    operating_hours: 'L-V 8-18',
    is_active: true,
    created_at: '2026-05-10T22:00:00Z',
    updated_at: '2026-05-10T22:00:00Z',
    deleted_at: null,
    ...overrides,
  };
}

// jsdom no implementa scrollIntoView. El hook useScrollToFirstError lo llama
// al submit con errores; sin stub el test pasa pero vitest reporta error.
// Mismo workaround que conductores.test.tsx y vehiculos.test.tsx.
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

describe('SucursalesListRoute', () => {
  it('empty state → mensaje + CTA Agregar', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({ sucursales: [] });
    providedContext = { kind: 'onboarded', me: makeMe() };
    wrap(<SucursalesListRoute />);
    await waitFor(() => expect(screen.getByText(/Aún no tienes sucursales/)).toBeInTheDocument());
    expect(screen.getByText('Agregar sucursal')).toBeInTheDocument();
  });

  it('sucursal con coords → no muestra badge "Sin coords"', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({ sucursales: [buildSucursal()] });
    providedContext = { kind: 'onboarded', me: makeMe() };
    wrap(<SucursalesListRoute />);
    await waitFor(() => expect(screen.getByText('Bodega Maipú')).toBeInTheDocument());
    expect(screen.queryByText('Sin coords')).toBeNull();
  });

  it('sucursal sin coords → muestra badge "Sin coords"', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      sucursales: [buildSucursal({ latitude: null, longitude: null })],
    });
    providedContext = { kind: 'onboarded', me: makeMe() };
    wrap(<SucursalesListRoute />);
    await waitFor(() => expect(screen.getByText('Sin coords')).toBeInTheDocument());
  });

  it('rol conductor no ve botón "Nueva sucursal"', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({ sucursales: [] });
    providedContext = { kind: 'onboarded', me: makeMe('conductor') };
    wrap(<SucursalesListRoute />);
    await waitFor(() => expect(screen.getByText(/Aún no tienes sucursales/)).toBeInTheDocument());
    expect(screen.queryByText('Nueva sucursal')).toBeNull();
  });
});

describe('SucursalesNuevaRoute', () => {
  it('conductor → bloqueo "Sin permisos"', () => {
    providedContext = { kind: 'onboarded', me: makeMe('conductor') };
    wrap(<SucursalesNuevaRoute />);
    expect(screen.getByText('Sin permisos')).toBeInTheDocument();
  });

  it('despachador → muestra form', () => {
    providedContext = { kind: 'onboarded', me: makeMe('despachador') };
    wrap(<SucursalesNuevaRoute />);
    expect(screen.getByText(/Nueva sucursal/)).toBeInTheDocument();
  });
});

// El form declara `noValidate`, así que los min/max HTML5 de Latitud y
// Longitud NO bloquean el submit — la validación debe correr en submit() y el
// 400 de zValidator del server debe llegar legible. Misma clase de bug que el
// incidente de vehículos (PR #650). Ver
// .specs/fix-sucursales-form-validacion/spec.md.
describe('SucursalForm — validación de coordenadas y 400 legible', () => {
  function renderNueva() {
    providedContext = { kind: 'onboarded', me: makeMe() };
    wrap(<SucursalesNuevaRoute />);
  }

  function fillBase() {
    fireEvent.change(screen.getByLabelText(/Nombre/), { target: { value: 'Bodega Maipú' } });
    fireEvent.change(screen.getByLabelText(/Dirección/), {
      target: { value: 'Av. Pajaritos 1234' },
    });
    fireEvent.change(screen.getByLabelText(/Ciudad \/ Comuna/), { target: { value: 'Maipú' } });
  }

  it('latitud fuera de rango → error de campo, sin llamar al API', async () => {
    const postSpy = vi.spyOn(api, 'post').mockResolvedValue({ sucursal: buildSucursal() });
    renderNueva();
    fillBase();
    fireEvent.change(screen.getByLabelText(/Latitud/), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear sucursal' }));

    await waitFor(() => expect(screen.getByText(/entre -90 y 90/)).toBeInTheDocument());
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('longitud fuera de rango → error de campo, sin llamar al API', async () => {
    const postSpy = vi.spyOn(api, 'post').mockResolvedValue({ sucursal: buildSucursal() });
    renderNueva();
    fillBase();
    fireEvent.change(screen.getByLabelText(/Longitud/), { target: { value: '-200' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear sucursal' }));

    await waitFor(() => expect(screen.getByText(/entre -180 y 180/)).toBeInTheDocument());
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('coordenadas decimales válidas → SÍ llama al API', async () => {
    const postSpy = vi.spyOn(api, 'post').mockResolvedValue({ sucursal: buildSucursal() });
    renderNueva();
    fillBase();
    fireEvent.change(screen.getByLabelText(/Latitud/), { target: { value: '-33.5111' } });
    fireEvent.change(screen.getByLabelText(/Longitud/), { target: { value: '-70.7575' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear sucursal' }));

    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    expect(postSpy).toHaveBeenCalledWith(
      '/sucursales',
      expect.objectContaining({ latitude: -33.5111, longitude: -70.7575 }),
    );
  });

  it('400 zValidator del server → banner nombra el campo, no "API error 400"', async () => {
    // Valores válidos client-side; el server igual responde 400 (drift).
    // Shape real de @hono/zod-validator sin hook custom.
    const postSpy = vi.spyOn(api, 'post').mockRejectedValue(
      new ApiError(400, undefined, {
        success: false,
        error: {
          name: 'ZodError',
          issues: [{ path: ['latitude'], message: 'Too big', code: 'too_big' }],
        },
      }),
    );
    renderNueva();
    fillBase();
    fireEvent.change(screen.getByLabelText(/Latitud/), { target: { value: '45' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear sucursal' }));

    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText(/Revisa los campos: Latitud/)).toBeInTheDocument());
    expect(screen.queryByText(/API error 400/)).toBeNull();
  });
});

describe('SucursalesDetalleRoute', () => {
  it('renderiza form con datos de la sucursal', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({ sucursal: buildSucursal() });
    providedContext = { kind: 'onboarded', me: makeMe('admin') };
    wrap(<SucursalesDetalleRoute />);
    await waitFor(() => expect(screen.getAllByText('Bodega Maipú')[0]).toBeInTheDocument());
  });
});
