import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  Link: ({
    children,
    search,
    ...props
  }: {
    children: ReactNode;
    search?: Record<string, string | number | undefined>;
  }) => {
    const destino = 'to' in props && typeof props.to === 'string' ? props.to : undefined;
    return (
      <a href={destino} {...props} data-search={search ? JSON.stringify(search) : undefined}>
        {children}
      </a>
    );
  },
  useNavigate: () => vi.fn(),
  useParams: () => ({ id: 'veh-1' }),
}));

vi.mock('../components/Layout.js', () => ({
  Layout: ({ children, title }: { children: ReactNode; title: string }) => (
    <div data-testid="layout" data-title={title}>
      {children}
    </div>
  ),
}));

vi.mock('../components/EmptyState.js', () => ({
  EmptyState: ({
    title,
    description,
    action,
  }: {
    title: string;
    description?: string;
    action?: ReactNode;
  }) => (
    <div data-testid="empty-state">
      <p>{title}</p>
      {description ? <p>{description}</p> : null}
      {action}
    </div>
  ),
  emptyStateActionClass: 'btn',
}));

vi.mock('../components/map/VehicleMap.js', () => ({
  VehicleMap: () => <div data-testid="vehicle-map" />,
}));

vi.mock('../components/map/TrazaMapPreview.js', () => ({
  TrazaMapPreview: () => <div data-testid="traza-map" />,
}));

const { VehiculosListRoute, VehiculosNuevoRoute, VehiculosDetalleRoute } = await import(
  './vehiculos.js'
);

function makeMe(): MeOnboarded {
  return {
    needs_onboarding: false,
    user: { id: 'u', full_name: 'F' } as MeOnboarded['user'],
    memberships: [],
    active_membership: {
      id: 'm',
      role: 'dueno',
      status: 'activa',
      joined_at: null,
      empresa: {
        id: 'e',
        legal_name: 'E',
        rut: '76',
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

// jsdom no implementa scrollIntoView. El hook useScrollToFirstError lo llama
// al submit con errores; sin stub el test pasa pero vitest reporta error.
// Mismo workaround que conductores.test.tsx.
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

const IMEI_LISTA = '356307042441013';

function vehiculoLista(
  overrides: Partial<{
    id: string;
    plate: string;
    type: string;
    capacity_kg: number;
    capacity_m3: number | null;
    brand: string | null;
    model: string | null;
    teltonika_imei: string | null;
    status: 'activo' | 'mantenimiento' | 'retirado';
  }> = {},
) {
  return {
    id: 'v1',
    plate: 'ABCD12',
    type: 'camion_pequeno',
    capacity_kg: 5000,
    capacity_m3: null,
    brand: null,
    model: null,
    teltonika_imei: null,
    status: 'activo' as const,
    ...overrides,
  };
}

function mockLista(
  vehicles: ReturnType<typeof vehiculoLista>[],
  fleet: Array<{
    id: string;
    position: { timestamp_device: string } | null;
  }> = [],
) {
  return vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path === '/vehiculos/flota') {
      return { fleet };
    }
    if (path === '/vehiculos') {
      return { vehicles };
    }
    return {} as never;
  });
}

describe('VehiculosListRoute', () => {
  it('no onboarded → no renderiza', () => {
    const { container } = wrap(<VehiculosListRoute />);
    expect(container.querySelector('[data-testid="layout"]')).toBeNull();
  });

  it('onboarded + lista vacía → frase corta, CTA y enlace al mapa', async () => {
    mockLista([]);
    providedContext = { kind: 'onboarded', me: makeMe() };
    wrap(<VehiculosListRoute />);
    await waitFor(() => expect(screen.getByText(/Aún no tienes vehículos/)).toBeInTheDocument());
    expect(screen.getByText(/Cuando sumes el primero/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /ver mapa/i })).toHaveAttribute('to', '/app/flota');
    expect(screen.getAllByRole('link', { name: /nuevo vehículo/i }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('sin IMEI → pill Sin dispositivo, sin el identificador y sin ver en vivo', async () => {
    mockLista([vehiculoLista({ teltonika_imei: null })]);
    providedContext = { kind: 'onboarded', me: makeMe() };
    wrap(<VehiculosListRoute />);
    await waitFor(() => expect(screen.getAllByText('Sin dispositivo').length).toBeGreaterThan(0));
    expect(screen.queryByText(/IMEI/i)).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Combustible' })).toBeNull();
    expect(screen.getByRole('columnheader', { name: 'Dispositivo' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /ver en vivo/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /^editar$/i })).toBeNull();
    const tabla = screen.getByTestId('vehiculos-tabla');
    expect(tabla).toHaveClass('hidden', 'lg:block');
    expect(tabla.className).not.toMatch(/overflow-x-auto/);
    expect(within(tabla).getByRole('link', { name: /^abrir$/i })).toHaveAttribute(
      'to',
      '/app/vehiculos/$id',
    );
    const cards = screen.getByTestId('vehiculos-cards');
    expect(cards).toHaveClass('lg:hidden');
    expect(cards.querySelector('table')).toBeNull();
    expect(within(cards).getByRole('link', { name: /abrir/i })).toHaveAttribute(
      'to',
      '/app/vehiculos/$id',
    );
    fireEvent.click(screen.getByRole('button', { name: /más acciones/i }));
    expect(screen.getByRole('menuitem', { name: /^editar$/i })).toHaveAttribute(
      'to',
      '/app/vehiculos/$id',
    );
    expect(screen.queryByRole('menuitem', { name: /ver en vivo/i })).toBeNull();
  });

  it('con IMEI fresco muestra Conectado y Ver en vivo; el IMEI no se imprime', async () => {
    mockLista(
      [vehiculoLista({ teltonika_imei: IMEI_LISTA, brand: 'Volvo', model: 'FH' })],
      [{ id: 'v1', position: { timestamp_device: new Date().toISOString() } }],
    );
    providedContext = { kind: 'onboarded', me: makeMe() };
    wrap(<VehiculosListRoute />);
    await waitFor(() => expect(screen.getAllByText('Conectado').length).toBeGreaterThan(0));
    expect(screen.queryByText(IMEI_LISTA)).toBeNull();
    expect(screen.getAllByText('Volvo FH').length).toBeGreaterThan(0);
    const cards = screen.getByTestId('vehiculos-cards');
    expect(within(cards).getByRole('link', { name: /ver en vivo/i })).toHaveAttribute(
      'to',
      '/app/vehiculos/$id/live',
    );
    expect(
      within(screen.getByTestId('vehiculos-tabla')).queryByRole('link', { name: /ver en vivo/i }),
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /más acciones/i }));
    expect(screen.getByRole('menuitem', { name: /ver en vivo/i })).toHaveAttribute(
      'to',
      '/app/vehiculos/$id/live',
    );
  });

  it('con IMEI y sin punto fresco muestra Sin señal', async () => {
    mockLista([vehiculoLista({ teltonika_imei: IMEI_LISTA })], [{ id: 'v1', position: null }]);
    providedContext = { kind: 'onboarded', me: makeMe() };
    wrap(<VehiculosListRoute />);
    await waitFor(() => expect(screen.getAllByText('Sin señal').length).toBeGreaterThan(0));
    expect(screen.queryByText(IMEI_LISTA)).toBeNull();
  });

  it('los chips muestran conteos y filtran; Limpiar vuelve a la flota', async () => {
    mockLista(
      [
        vehiculoLista({ id: 'v1', plate: 'ABCD12', status: 'activo', teltonika_imei: null }),
        vehiculoLista({
          id: 'v2',
          plate: 'XYZW99',
          status: 'mantenimiento',
          teltonika_imei: IMEI_LISTA,
          brand: 'Volvo',
          model: 'FH',
        }),
        vehiculoLista({
          id: 'v3',
          plate: 'JKLM11',
          status: 'retirado',
          teltonika_imei: null,
        }),
      ],
      [{ id: 'v2', position: null }],
    );
    providedContext = { kind: 'onboarded', me: makeMe() };
    wrap(<VehiculosListRoute />);
    await waitFor(() => expect(screen.getByTestId('filtro-sin_senal')).toHaveTextContent('1'));
    const activos = screen.getByTestId('filtro-activos');
    expect(activos).toHaveTextContent('Activos');
    expect(activos).toHaveTextContent('1');
    expect(screen.getByTestId('filtro-todos')).toHaveTextContent('3');
    expect(screen.getByTestId('filtro-mantencion')).toHaveTextContent('1');
    expect(screen.getByTestId('filtro-retirados')).toHaveTextContent('1');
    expect(screen.getByTestId('filtro-sin_dispositivo')).toHaveTextContent('2');
    expect(screen.getByTestId('filtro-sin_senal')).toHaveTextContent('1');

    fireEvent.click(screen.getByTestId('filtro-mantencion'));
    expect(screen.getAllByText(/XY/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/JK/)).toBeNull();

    fireEvent.change(screen.getByRole('searchbox', { name: /buscar vehículos/i }), {
      target: { value: 'zzzz' },
    });
    expect(screen.getByText(/ningún vehículo coincide/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^limpiar$/i }));
    expect(screen.getByTestId('filtro-todos')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByText(/AB/).length).toBeGreaterThan(0);
  });

  it('error de carga ofrece Reintentar', async () => {
    let fallar = true;
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/vehiculos' && fallar) {
        throw new Error('red');
      }
      if (path === '/vehiculos') {
        return { vehicles: [vehiculoLista()] };
      }
      return { fleet: [] };
    });
    providedContext = { kind: 'onboarded', me: makeMe() };
    wrap(<VehiculosListRoute />);
    const reintentar = await screen.findByRole('button', { name: /reintentar/i });
    expect(screen.getByRole('alert')).toHaveTextContent(/no pudimos cargar los vehículos/i);
    fallar = false;
    fireEvent.click(reintentar);
    await waitFor(() => expect(screen.getAllByText('Sin dispositivo').length).toBeGreaterThan(0));
  });

  it('mientras carga muestra skeleton y no la tabla', () => {
    vi.spyOn(api, 'get').mockImplementation(() => new Promise(() => undefined));
    providedContext = { kind: 'onboarded', me: makeMe() };
    wrap(<VehiculosListRoute />);
    expect(screen.getByTestId('vehiculos-cargando')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByTestId('vehiculos-cards')).toBeNull();
  });

  it('conductor no ve Nuevo vehículo ni Editar; con IMEI sí ve en vivo', async () => {
    mockLista(
      [vehiculoLista({ teltonika_imei: IMEI_LISTA })],
      [{ id: 'v1', position: { timestamp_device: new Date().toISOString() } }],
    );
    const me = makeMe();
    providedContext = {
      kind: 'onboarded',
      me: {
        ...me,
        active_membership: { ...me.active_membership, role: 'conductor' },
      } as MeOnboarded,
    };
    wrap(<VehiculosListRoute />);
    await waitFor(() => expect(screen.getAllByText('Conectado').length).toBeGreaterThan(0));
    expect(screen.queryByRole('link', { name: /nuevo vehículo/i })).toBeNull();
    expect(screen.getByRole('link', { name: /ver mapa/i })).toHaveAttribute('to', '/app/flota');
    expect(
      within(screen.getByTestId('vehiculos-cards')).getByRole('link', { name: /ver en vivo/i }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /más acciones/i }));
    expect(screen.getByRole('menuitem', { name: /ver en vivo/i })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /^editar$/i })).toBeNull();
  });
});

describe('VehiculosNuevoRoute', () => {
  it('no onboarded → no renderiza', () => {
    const { container } = wrap(<VehiculosNuevoRoute />);
    expect(container.querySelector('[data-testid="layout"]')).toBeNull();
  });

  it('onboarded → renderiza Layout', () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    wrap(<VehiculosNuevoRoute />);
    expect(screen.getByTestId('layout')).toBeInTheDocument();
  });
});

// El form tiene `noValidate`, así que los attributes HTML5 (min/max/required)
// NO bloquean el submit — la validación de rangos debe correr en submit() y
// el 400 de zValidator del server debe mapearse a copy legible. Incidente
// reproducido en prod 2026-08-15: capacity_m3=10000 → banner "API error 400"
// sin indicación del campo. Ver .specs/fix-vehiculos-form-validacion/spec.md.
describe('VehicleForm — validación de rangos y 400 legible', () => {
  function renderNuevo() {
    providedContext = { kind: 'onboarded', me: makeMe() };
    wrap(<VehiculosNuevoRoute />);
  }

  function fillBase({ capacityKg = '10000' }: { capacityKg?: string } = {}) {
    fireEvent.change(screen.getByLabelText(/Patente/), { target: { value: 'JLKT54' } });
    fireEvent.change(screen.getByLabelText(/Capacidad \(kg\)/), {
      target: { value: capacityKg },
    });
  }

  it('capacity_m3 fuera de rango → error de campo, sin llamar al API', async () => {
    const postSpy = vi.spyOn(api, 'post').mockResolvedValue({ vehicle: {} });
    renderNuevo();
    fillBase();
    fireEvent.change(screen.getByLabelText(/Capacidad \(m³\)/), { target: { value: '10000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear vehículo' }));

    await waitFor(() => expect(screen.getByText(/entre 1 y 500/)).toBeInTheDocument());
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('capacity_kg vacío → error de campo, sin mandar NaN al API', async () => {
    const postSpy = vi.spyOn(api, 'post').mockResolvedValue({ vehicle: {} });
    renderNuevo();
    fillBase({ capacityKg: '' });
    fireEvent.click(screen.getByRole('button', { name: 'Crear vehículo' }));

    await waitFor(() =>
      expect(screen.getByText('Ingresa la capacidad de carga')).toBeInTheDocument(),
    );
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('400 zValidator del server → banner nombra el campo, no "API error 400"', async () => {
    // Valores válidos client-side; el server igual responde 400 (drift de
    // reglas server-side). Shape real de @hono/zod-validator sin hook custom
    // — mismo contrato verificado en solicitar-acceso.tsx.
    const postSpy = vi.spyOn(api, 'post').mockRejectedValue(
      new ApiError(400, undefined, {
        success: false,
        error: {
          name: 'ZodError',
          issues: [{ path: ['capacity_m3'], message: 'Too big', code: 'too_big' }],
        },
      }),
    );
    renderNuevo();
    fillBase();
    fireEvent.change(screen.getByLabelText(/Capacidad \(m³\)/), { target: { value: '400' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear vehículo' }));

    await waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByText(/Revisa los campos: Capacidad \(m³\)/)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/API error 400/)).toBeNull();
  });

  it('capacity_kg decimal → exige entero, sin llamar al API', async () => {
    const postSpy = vi.spyOn(api, 'post').mockResolvedValue({ vehicle: {} });
    renderNuevo();
    fillBase({ capacityKg: '12.5' });
    fireEvent.click(screen.getByRole('button', { name: 'Crear vehículo' }));

    await waitFor(() => expect(screen.getByText('Debe ser un número entero')).toBeInTheDocument());
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('409 patente duplicada → copy amigable, no "plate_already_exists"', async () => {
    // Shape real del 409 en apps/api/src/routes/vehiculos.ts: el `error`
    // (que se vuelve ApiError.message) es 'plate_already_exists' y el
    // `code` es 'plate_duplicate' — el copy amigable debe salir del code.
    vi.spyOn(api, 'post').mockRejectedValue(
      new ApiError(409, 'plate_duplicate', undefined, 'plate_already_exists'),
    );
    renderNuevo();
    fillBase();
    fireEvent.click(screen.getByRole('button', { name: 'Crear vehículo' }));

    await waitFor(() =>
      expect(screen.getByText('Ya existe un vehículo con esa patente.')).toBeInTheDocument(),
    );
    expect(screen.queryByText('plate_already_exists')).toBeNull();
  });
});

describe('VehiculosDetalleRoute', () => {
  it('no onboarded → no renderiza', () => {
    const { container } = wrap(<VehiculosDetalleRoute />);
    expect(container.querySelector('[data-testid="layout"]')).toBeNull();
  });

  it('onboarded + GET ok → renderiza plate del detalle', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/vehiculos/veh-1') {
        return {
          vehicle: {
            id: 'veh-1',
            plate: 'XYZ789',
            type: 'camion_grande',
            capacity_kg: 20000,
            capacity_m3: null,
            year: 2022,
            brand: 'Volvo',
            model: 'FH',
            fuel_type: 'diesel',
            curb_weight_kg: 10000,
            consumption_l_per_100km_baseline: '32.5',
            teltonika_imei: null,
            rut: null,
            status: 'activo',
            available_for_assignment: true,
            notes: null,
            created_at: '2026-05-10T10:00:00Z',
          },
        };
      }
      // Otras queries devolverán null/objetos vacíos.
      return {} as never;
    });
    providedContext = { kind: 'onboarded', me: makeMe() };
    wrap(<VehiculosDetalleRoute />);
    await waitFor(() =>
      expect(
        screen.getAllByText((_t, n) => n?.textContent?.includes('XY') ?? false).length,
      ).toBeGreaterThan(0),
    );
  });
});

// =============================================================================
// Dispositivo Teltonika (W2b) — sección self-service en VehiculoDetallePage
// =============================================================================

function makeVehicleRow(
  overrides: Partial<{
    teltonika_imei: string | null;
    brand: string | null;
    model: string | null;
    capacity_kg: number;
    status: 'activo' | 'mantenimiento' | 'retirado';
  }> = {},
) {
  return {
    id: 'veh-1',
    plate: 'ABCD12',
    type: 'camion_pequeno',
    capacity_kg: 5000,
    capacity_m3: null,
    year: 2020,
    brand: null,
    model: null,
    fuel_type: null,
    curb_weight_kg: null,
    consumption_l_per_100km_baseline: null,
    teltonika_imei: null,
    status: 'activo',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function mockDetalleGet(teltonikaImei: string | null) {
  return vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path === '/vehiculos/veh-1') {
      return { vehicle: makeVehicleRow({ teltonika_imei: teltonikaImei }) };
    }
    return {} as never;
  });
}

const IMEI_VALIDO = '356307042441013';

describe('VehiculoDetallePage — Dispositivo Teltonika (W2b)', () => {
  it('sin IMEI → muestra "Sin dispositivo" y sin links de telemetría (vivo/recorrido)', async () => {
    mockDetalleGet(null);
    providedContext = { kind: 'onboarded', me: makeMe() };
    wrap(<VehiculosDetalleRoute />);
    await waitFor(() => expect(screen.getAllByText(/sin dispositivo/i).length).toBeGreaterThan(0));
    expect(screen.queryByText(/ver en vivo/i)).toBeNull();
    expect(screen.queryByText(/recorrido/i)).toBeNull();
  });

  it('con IMEI → muestra el IMEI actual y los links a vivo + recorrido', async () => {
    mockDetalleGet(IMEI_VALIDO);
    providedContext = { kind: 'onboarded', me: makeMe() };
    wrap(<VehiculosDetalleRoute />);
    await waitFor(() => expect(screen.getAllByText(IMEI_VALIDO).length).toBeGreaterThan(0));
    expect(
      within(screen.getByTestId('hub-acciones')).getByText(/ver en vivo/i),
    ).toBeInTheDocument();
    // Link "Recorrido" → /app/vehiculos/$id/historial (puerta de entrada al historial).
    const recorrido = screen.getByText(/recorrido/i).closest('a');
    expect(recorrido).toHaveAttribute('to', '/app/vehiculos/$id/historial');
  });

  it('despachador (sin permiso dueno/admin) → no ve el input de edición', async () => {
    mockDetalleGet(null);
    const me = makeMe();
    providedContext = {
      kind: 'onboarded',
      me: {
        ...me,
        active_membership: { ...me.active_membership, role: 'despachador' },
      } as MeOnboarded,
    };
    wrap(<VehiculosDetalleRoute />);
    await waitFor(() => expect(screen.getAllByText(/sin dispositivo/i).length).toBeGreaterThan(0));
    expect(screen.queryByPlaceholderText('15 dígitos')).toBeNull();
  });

  it('validación client: IMEI de menos de 15 dígitos no dispara el PATCH', async () => {
    mockDetalleGet(null);
    const patchSpy = vi.spyOn(api, 'patch');
    providedContext = { kind: 'onboarded', me: makeMe() };
    wrap(<VehiculosDetalleRoute />);
    const input = await screen.findByPlaceholderText('15 dígitos');
    fireEvent.change(input, { target: { value: '123' } });
    fireEvent.click(screen.getByRole('button', { name: /^guardar$/i }));

    await waitFor(() => expect(screen.getByText(/15 dígitos/i)).toBeInTheDocument());
    expect(patchSpy).not.toHaveBeenCalled();
  });

  it('guardar feliz → PATCH con body correcto e invalida la query del detalle', async () => {
    const getSpy = mockDetalleGet(null);
    const patchSpy = vi.spyOn(api, 'patch').mockResolvedValue({
      vehicle: makeVehicleRow({ teltonika_imei: IMEI_VALIDO }),
      reconciliacion: 'sin_registro',
      reemplazado_anterior: false,
    });
    providedContext = { kind: 'onboarded', me: makeMe() };
    wrap(<VehiculosDetalleRoute />);
    const input = await screen.findByPlaceholderText('15 dígitos');
    fireEvent.change(input, { target: { value: IMEI_VALIDO } });
    fireEvent.click(screen.getByRole('button', { name: /^guardar$/i }));

    await waitFor(() =>
      expect(patchSpy).toHaveBeenCalledWith('/vehiculos/veh-1/dispositivo', {
        teltonika_imei: IMEI_VALIDO,
      }),
    );
    await waitFor(() =>
      expect(getSpy.mock.calls.filter((c) => c[0] === '/vehiculos/veh-1').length).toBeGreaterThan(
        1,
      ),
    );
  });

  it('quitar dispositivo (PATCH null) requiere confirmación', async () => {
    mockDetalleGet(IMEI_VALIDO);
    const patchSpy = vi.spyOn(api, 'patch').mockResolvedValue({
      vehicle: makeVehicleRow({ teltonika_imei: null }),
      reconciliacion: null,
      reemplazado_anterior: true,
    });
    providedContext = { kind: 'onboarded', me: makeMe() };
    wrap(<VehiculosDetalleRoute />);
    await screen.findByPlaceholderText('15 dígitos');

    fireEvent.click(screen.getByRole('button', { name: /^quitar$/i }));
    expect(patchSpy).not.toHaveBeenCalled();
    expect(screen.getByText(/¿quitar el dispositivo\?/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /sí, quitar/i }));
    await waitFor(() =>
      expect(patchSpy).toHaveBeenCalledWith('/vehiculos/veh-1/dispositivo', {
        teltonika_imei: null,
      }),
    );
  });

  it('quitar exitoso → el input no conserva el IMEI y "Guardar" no re-asocia silenciosamente', async () => {
    // Simula backend real: el GET refleja el estado que dejó el último PATCH,
    // no un mock estático (finding W2b: currentImei cambia tras el refetch
    // pero imeiInput quedaba con el valor viejo — "Guardar" podía reasociarlo
    // sin que el usuario lo haya tocado).
    let teltonikaImei: string | null = IMEI_VALIDO;
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/vehiculos/veh-1') {
        return { vehicle: makeVehicleRow({ teltonika_imei: teltonikaImei }) };
      }
      return {} as never;
    });
    const patchSpy = vi
      .spyOn(api, 'patch')
      .mockImplementation(async (_path: string, body: unknown) => {
        teltonikaImei = (body as { teltonika_imei: string | null }).teltonika_imei;
        return {
          vehicle: makeVehicleRow({ teltonika_imei: teltonikaImei }),
          reconciliacion: null,
          reemplazado_anterior: true,
        };
      });
    providedContext = { kind: 'onboarded', me: makeMe() };
    wrap(<VehiculosDetalleRoute />);

    const input = (await screen.findByPlaceholderText('15 dígitos')) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe(IMEI_VALIDO));

    fireEvent.click(screen.getByRole('button', { name: /^quitar$/i }));
    fireEvent.click(screen.getByRole('button', { name: /sí, quitar/i }));

    await waitFor(() =>
      expect(patchSpy).toHaveBeenCalledWith('/vehiculos/veh-1/dispositivo', {
        teltonika_imei: null,
      }),
    );
    await waitFor(() => expect(screen.getAllByText(/sin dispositivo/i).length).toBeGreaterThan(0));

    // El input debe quedar vacío, no conservar el IMEI recién quitado.
    await waitFor(() => expect(input.value).toBe(''));

    // Un click en "Guardar" con el input ya sincronizado (vacío) no debe
    // re-disparar el PATCH con el IMEI viejo: la validación client rechaza
    // el string vacío antes de llegar a la mutación.
    patchSpy.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /^guardar$/i }));
    expect(patchSpy).not.toHaveBeenCalled();
  });

  it('error imei_en_uso → mensaje "ya está asociado a otro vehículo"', async () => {
    mockDetalleGet(null);
    vi.spyOn(api, 'patch').mockRejectedValue(
      new ApiError(409, 'imei_en_uso', { error: 'imei_en_uso', code: 'imei_en_uso' }),
    );
    providedContext = { kind: 'onboarded', me: makeMe() };
    wrap(<VehiculosDetalleRoute />);
    const input = await screen.findByPlaceholderText('15 dígitos');
    fireEvent.change(input, { target: { value: IMEI_VALIDO } });
    fireEvent.click(screen.getByRole('button', { name: /^guardar$/i }));

    await waitFor(() =>
      expect(screen.getByText(/ya está asociado a otro vehículo/i)).toBeInTheDocument(),
    );
  });

  it('error imei_espejo_activo → mensaje sobre el espejo demo', async () => {
    mockDetalleGet(null);
    vi.spyOn(api, 'patch').mockRejectedValue(
      new ApiError(422, 'imei_espejo_activo', {
        error: 'imei_espejo_activo',
        code: 'imei_espejo_activo',
      }),
    );
    providedContext = { kind: 'onboarded', me: makeMe() };
    wrap(<VehiculosDetalleRoute />);
    const input = await screen.findByPlaceholderText('15 dígitos');
    fireEvent.change(input, { target: { value: IMEI_VALIDO } });
    fireEvent.click(screen.getByRole('button', { name: /^guardar$/i }));

    await waitFor(() => expect(screen.getByText(/espejo/i)).toBeInTheDocument());
  });

  it('error pending_device_conflict → mensaje de reintento + refetch', async () => {
    const getSpy = mockDetalleGet(null);
    vi.spyOn(api, 'patch').mockRejectedValue(
      new ApiError(409, 'pending_device_conflict', {
        error: 'pending_device_conflict',
        code: 'pending_device_conflict',
        status: 'aprobado',
      }),
    );
    providedContext = { kind: 'onboarded', me: makeMe() };
    wrap(<VehiculosDetalleRoute />);
    const input = await screen.findByPlaceholderText('15 dígitos');
    fireEvent.change(input, { target: { value: IMEI_VALIDO } });
    fireEvent.click(screen.getByRole('button', { name: /^guardar$/i }));

    await waitFor(() =>
      expect(screen.getByText(/cambió mientras guardábamos/i)).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(getSpy.mock.calls.filter((c) => c[0] === '/vehiculos/veh-1').length).toBeGreaterThan(
        1,
      ),
    );
  });

  it('flujo dos pasos imei_rechazado → diálogo → confirmar_reasociacion:true', async () => {
    mockDetalleGet(null);
    const patchSpy = vi
      .spyOn(api, 'patch')
      .mockRejectedValueOnce(
        new ApiError(409, 'imei_rechazado', {
          error: 'imei_rechazado',
          code: 'imei_rechazado',
          rechazado_en: '2026-06-01T12:00:00Z',
          motivo: 'reportado como robado',
        }),
      )
      .mockResolvedValueOnce({
        vehicle: makeVehicleRow({ teltonika_imei: IMEI_VALIDO }),
        reconciliacion: 'reaprobado_desde_rechazado',
        reemplazado_anterior: false,
        reasociado_desde: 'rechazado',
      });
    providedContext = { kind: 'onboarded', me: makeMe() };
    wrap(<VehiculosDetalleRoute />);
    const input = await screen.findByPlaceholderText('15 dígitos');
    fireEvent.change(input, { target: { value: IMEI_VALIDO } });
    fireEvent.click(screen.getByRole('button', { name: /^guardar$/i }));

    await waitFor(() => expect(screen.getByText(/reportado como robado/i)).toBeInTheDocument());
    expect(screen.getByText(/¿reasociar de todas formas\?/i)).toBeInTheDocument();
    expect(patchSpy).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /sí, reasociar/i }));

    await waitFor(() =>
      expect(patchSpy).toHaveBeenNthCalledWith(2, '/vehiculos/veh-1/dispositivo', {
        teltonika_imei: IMEI_VALIDO,
        confirmar_reasociacion: true,
      }),
    );
    await waitFor(() => expect(screen.getByText(/reasociado/i)).toBeInTheDocument());
  });

  it('flujo dos pasos imei_rechazado: cancelar no reintenta', async () => {
    mockDetalleGet(null);
    const patchSpy = vi.spyOn(api, 'patch').mockRejectedValue(
      new ApiError(409, 'imei_rechazado', {
        error: 'imei_rechazado',
        code: 'imei_rechazado',
        rechazado_en: '2026-06-01T12:00:00Z',
        motivo: 'reportado como robado',
      }),
    );
    providedContext = { kind: 'onboarded', me: makeMe() };
    wrap(<VehiculosDetalleRoute />);
    const input = await screen.findByPlaceholderText('15 dígitos');
    fireEvent.change(input, { target: { value: IMEI_VALIDO } });
    fireEvent.click(screen.getByRole('button', { name: /^guardar$/i }));

    await waitFor(() =>
      expect(screen.getByText(/¿reasociar de todas formas\?/i)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: /^cancelar$/i }));

    expect(screen.queryByText(/¿reasociar de todas formas\?/i)).toBeNull();
    expect(patchSpy).toHaveBeenCalledTimes(1);
  });

  it('quitar dispositivo: cancelar no dispara el PATCH', async () => {
    mockDetalleGet(IMEI_VALIDO);
    const patchSpy = vi.spyOn(api, 'patch');
    providedContext = { kind: 'onboarded', me: makeMe() };
    wrap(<VehiculosDetalleRoute />);
    await screen.findByPlaceholderText('15 dígitos');

    fireEvent.click(screen.getByRole('button', { name: /^quitar$/i }));
    expect(screen.getByText(/¿quitar el dispositivo\?/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^cancelar$/i }));

    expect(screen.queryByText(/¿quitar el dispositivo\?/i)).toBeNull();
    expect(screen.getByRole('button', { name: /^quitar$/i })).toBeInTheDocument();
    expect(patchSpy).not.toHaveBeenCalled();
  });

  it('error no-ApiError (ej. fallo de red) → mensaje genérico', async () => {
    mockDetalleGet(null);
    vi.spyOn(api, 'patch').mockRejectedValue(new Error('network down'));
    providedContext = { kind: 'onboarded', me: makeMe() };
    wrap(<VehiculosDetalleRoute />);
    const input = await screen.findByPlaceholderText('15 dígitos');
    fireEvent.change(input, { target: { value: IMEI_VALIDO } });
    fireEvent.click(screen.getByRole('button', { name: /^guardar$/i }));

    await waitFor(() =>
      expect(
        screen.getByText(/no se pudo actualizar el dispositivo\. intenta nuevamente/i),
      ).toBeInTheDocument(),
    );
  });

  it('error 404 (vehicle_not_found, sin code) → "No se encontró el vehículo"', async () => {
    mockDetalleGet(null);
    vi.spyOn(api, 'patch').mockRejectedValue(
      new ApiError(404, undefined, { error: 'vehicle_not_found' }),
    );
    providedContext = { kind: 'onboarded', me: makeMe() };
    wrap(<VehiculosDetalleRoute />);
    const input = await screen.findByPlaceholderText('15 dígitos');
    fireEvent.change(input, { target: { value: IMEI_VALIDO } });
    fireEvent.click(screen.getByRole('button', { name: /^guardar$/i }));

    await waitFor(() =>
      expect(screen.getByText(/no se encontró el vehículo/i)).toBeInTheDocument(),
    );
  });

  it('error 400 sin code conocido → mensaje de validación', async () => {
    mockDetalleGet(null);
    vi.spyOn(api, 'patch').mockRejectedValue(new ApiError(400, undefined, { success: false }));
    providedContext = { kind: 'onboarded', me: makeMe() };
    wrap(<VehiculosDetalleRoute />);
    const input = await screen.findByPlaceholderText('15 dígitos');
    fireEvent.change(input, { target: { value: IMEI_VALIDO } });
    fireEvent.click(screen.getByRole('button', { name: /^guardar$/i }));

    await waitFor(() =>
      expect(screen.getByText(/el imei ingresado no es válido/i)).toBeInTheDocument(),
    );
  });

  it('error admin_required (403, code inesperado en esta UI) → mensaje de permisos', async () => {
    mockDetalleGet(null);
    vi.spyOn(api, 'patch').mockRejectedValue(
      new ApiError(403, 'admin_required', { error: 'forbidden', code: 'admin_required' }),
    );
    providedContext = { kind: 'onboarded', me: makeMe() };
    wrap(<VehiculosDetalleRoute />);
    const input = await screen.findByPlaceholderText('15 dígitos');
    fireEvent.change(input, { target: { value: IMEI_VALIDO } });
    fireEvent.click(screen.getByRole('button', { name: /^guardar$/i }));

    await waitFor(() =>
      expect(
        screen.getByText(/solo dueños o administradores pueden gestionar el dispositivo/i),
      ).toBeInTheDocument(),
    );
  });

  it('error 5xx sin code conocido → mensaje genérico de reintento', async () => {
    mockDetalleGet(null);
    vi.spyOn(api, 'patch').mockRejectedValue(
      new ApiError(500, undefined, { error: 'internal_error' }),
    );
    providedContext = { kind: 'onboarded', me: makeMe() };
    wrap(<VehiculosDetalleRoute />);
    const input = await screen.findByPlaceholderText('15 dígitos');
    fireEvent.change(input, { target: { value: IMEI_VALIDO } });
    fireEvent.click(screen.getByRole('button', { name: /^guardar$/i }));

    await waitFor(() =>
      expect(
        screen.getByText(/no se pudo actualizar el dispositivo\. intenta nuevamente/i),
      ).toBeInTheDocument(),
    );
  });

  it('imei_rechazado con payload sin rechazado_en/motivo → fallback "fecha desconocida"', async () => {
    mockDetalleGet(null);
    vi.spyOn(api, 'patch').mockRejectedValue(
      new ApiError(409, 'imei_rechazado', { error: 'imei_rechazado', code: 'imei_rechazado' }),
    );
    providedContext = { kind: 'onboarded', me: makeMe() };
    wrap(<VehiculosDetalleRoute />);
    const input = await screen.findByPlaceholderText('15 dígitos');
    fireEvent.change(input, { target: { value: IMEI_VALIDO } });
    fireEvent.click(screen.getByRole('button', { name: /^guardar$/i }));

    await waitFor(() => expect(screen.getByText(/fecha desconocida/i)).toBeInTheDocument());
    expect(screen.getByText(/¿reasociar de todas formas\?/i)).toBeInTheDocument();
  });
});

describe('VehiculoDetallePage — hub', () => {
  it('dueño ve el hub antes del formulario de IMEI y sin placa decorativa', async () => {
    mockDetalleGet(null);
    providedContext = { kind: 'onboarded', me: makeMe() };
    wrap(<VehiculosDetalleRoute />);
    const resumen = await screen.findByTestId('hub-resumen');
    const config = screen.getByTestId('configuracion-vehiculo');
    expect(resumen.compareDocumentPosition(config) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const dispositivo = screen.getByTestId('hub-estado');
    expect(dispositivo).toHaveTextContent(/dispositivo/i);
    expect(dispositivo).toHaveTextContent(/sin dispositivo/i);
    expect(dispositivo).toHaveAttribute('aria-live', 'polite');
    const flota = screen.getByTestId('hub-flota');
    expect(flota).toHaveTextContent(/flota/i);
    expect(flota).toHaveTextContent(/activo/i);
    const configCerrada = screen.getByTestId('configuracion-vehiculo');
    expect(configCerrada).not.toHaveAttribute('open');
    expect(configCerrada.querySelector('summary svg')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('heading', { level: 1 }).querySelector('svg')).toBeNull();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('AB·CD·12');
    expect(screen.queryByText('CHILE')).toBeNull();
    expect(screen.queryByRole('link', { name: /ver en vivo/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /^recorrido$/i })).toBeNull();
    expect(screen.getByRole('link', { name: /^vehículos$/i })).toHaveAttribute(
      'to',
      '/app/vehiculos',
    );
    expect(screen.queryByRole('link', { name: /^flota$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^retirar$/i })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /retirar/i })).toBeNull();
    const acciones = screen.getByTestId('hub-acciones');
    const primaria = within(acciones).getByRole('button', { name: /configurar dispositivo/i });
    expect(primaria.className).toContain('bg-primary-600');
    expect(acciones.querySelectorAll('.bg-primary-600')).toHaveLength(1);
    const tituloDispositivo = screen.getByRole('heading', { name: 'Dispositivo' });
    const tituloDatos = screen.getByRole('heading', { name: 'Datos' });
    const tituloDocumentos = screen.getByRole('heading', { name: /documentos/i });
    expect(
      tituloDispositivo.compareDocumentPosition(tituloDatos) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      tituloDatos.compareDocumentPosition(tituloDocumentos) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByText(/asociación a teltonika/i)).toBeNull();
    expect(config.querySelector('input[placeholder="15 dígitos"]')).not.toBeNull();
    fireEvent.click(primaria);
    expect(screen.getByTestId('configuracion-vehiculo')).toHaveAttribute('open');
    expect(screen.getByPlaceholderText('15 dígitos')).toHaveFocus();
  });

  it('con trayectos muestra km, litros, alerta y los destinos de vivo y detalle', async () => {
    const trayecto = {
      id: 't-1',
      vehiculo_id: 'veh-1',
      patente: 'ABCD12',
      inicio: '2026-09-02T15:00:00.000Z',
      fin: '2026-09-02T16:00:00.000Z',
      distancia_km: 42.5,
      litros_consumidos: 10,
      km_por_litro: 4.25,
      posible_robo_combustible: true,
      posible_robo_hormiga: true,
      event_lat: -33.4,
      event_lon: -70.6,
    };
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/vehiculos/veh-1') {
        return {
          vehicle: makeVehicleRow({
            teltonika_imei: IMEI_VALIDO,
            brand: 'Volvo',
            model: 'FH',
          }),
        };
      }
      if (path.startsWith('/trayectos-teltonika')) {
        return {
          resumen_vehiculo: {
            ultimo_trayecto: trayecto,
            recientes: [trayecto],
            km_recientes: 42.5,
            litros_recientes: 10,
            km_por_litro: 4.25,
            cta_sensor: false,
            alertas_total: 1,
            alerta_ultima: trayecto,
          },
        };
      }
      if (path.includes('/ubicacion')) {
        return {
          ubicacion: {
            timestamp_device: new Date().toISOString(),
            latitude: -33.4,
            longitude: -70.6,
            speed_kmh: 12,
          },
        };
      }
      if (path.includes('/traza')) {
        return {
          puntos: [
            { lat: -33.4, lng: -70.6 },
            { lat: -33.5, lng: -70.7 },
          ],
        };
      }
      return {} as never;
    });
    providedContext = { kind: 'onboarded', me: makeMe() };
    wrap(<VehiculosDetalleRoute />);

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('AB·CD·12');
    expect(screen.getByText('Volvo FH')).toBeInTheDocument();
    expect(await screen.findByText(/conectado/i)).toBeInTheDocument();
    expect(screen.getAllByText(/42,5 km/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/10,0 L/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Combustible').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Hormiga').length).toBeGreaterThan(0);
    expect(screen.queryByText(/posible robo/i)).toBeNull();
    expect(screen.getByText(/1 alerta en 30 días/)).toBeInTheDocument();
    expect(screen.getByTestId('hub-tarjeta-alertas').className).toContain('border-amber-200');

    const acciones = screen.getByTestId('hub-acciones');
    const llenos = acciones.querySelectorAll('.bg-primary-600');
    expect(llenos).toHaveLength(1);
    expect(llenos[0]).toHaveTextContent(/ver en vivo/i);
    expect(within(acciones).getByRole('link', { name: /ver en vivo/i })).toHaveAttribute(
      'to',
      '/app/vehiculos/$id/live',
    );
    expect(within(acciones).getByRole('link', { name: /^recorrido$/i }).className).toContain(
      'border',
    );
    expect(within(acciones).getByRole('link', { name: /^recorrido$/i }).className).not.toContain(
      'bg-primary-600',
    );
    const trayectosTexto = within(acciones).getByRole('link', { name: /ver trayectos/i });
    expect(trayectosTexto.className).not.toContain('border');
    expect(trayectosTexto.className).not.toContain('bg-primary-600');

    expect(screen.getByRole('link', { name: /ver en vivo/i })).toHaveAttribute(
      'to',
      '/app/vehiculos/$id/live',
    );
    const trayectos = screen.getByRole('link', { name: /ver trayectos/i });
    expect(trayectos).toHaveAttribute('to', '/app/trayectos');
    expect(trayectos.getAttribute('data-search')).toContain('"vehiculo":"veh-1"');
    const detalle = screen.getAllByRole('link', { name: 'Ver detalle' })[0];
    expect(detalle?.getAttribute('data-search')).toContain('"detalle":"t-1"');
    expect(detalle?.getAttribute('data-search')).toContain('"vehiculo":"veh-1"');
    expect(screen.getByRole('link', { name: /^recorrido$/i })).toHaveAttribute(
      'to',
      '/app/vehiculos/$id/historial',
    );
  });

  it('sin sensor muestra km y el CTA, sin inventar km/L', async () => {
    const trayecto = {
      id: 't-2',
      vehiculo_id: 'veh-1',
      patente: 'ABCD12',
      inicio: '2026-09-02T15:00:00.000Z',
      fin: '2026-09-02T16:00:00.000Z',
      distancia_km: 18,
      litros_consumidos: null,
      km_por_litro: null,
      posible_robo_combustible: false,
      posible_robo_hormiga: false,
      event_lat: null,
      event_lon: null,
    };
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/vehiculos/veh-1') {
        return { vehicle: makeVehicleRow({ teltonika_imei: IMEI_VALIDO }) };
      }
      if (path.startsWith('/trayectos-teltonika')) {
        return {
          resumen_vehiculo: {
            ultimo_trayecto: trayecto,
            recientes: [trayecto],
            km_recientes: 18,
            litros_recientes: null,
            km_por_litro: null,
            cta_sensor: true,
            alertas_total: 0,
            alerta_ultima: null,
          },
        };
      }
      if (path.includes('/ubicacion')) {
        throw new ApiError(404, 'no_points_yet', {});
      }
      return {} as never;
    });
    providedContext = { kind: 'onboarded', me: makeMe() };
    wrap(<VehiculosDetalleRoute />);
    expect((await screen.findAllByText('18,0 km')).length).toBeGreaterThan(0);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /conectá el sensor/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /conectá el sensor/i }));
    const config = screen.getByTestId('configuracion-vehiculo');
    expect(config).toHaveAttribute('open');
    expect(screen.getByPlaceholderText('15 dígitos')).toHaveFocus();
    expect(screen.queryByText(/km\/L/)).toBeNull();
    expect(screen.getByTestId('hub-estado')).toHaveTextContent(/sin señal/i);
  });

  it('el conductor no consulta trayectos y conserva ver en vivo', async () => {
    const get = vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/vehiculos/veh-1') {
        return { vehicle: makeVehicleRow({ teltonika_imei: IMEI_VALIDO }) };
      }
      if (path.includes('/ubicacion')) {
        throw new ApiError(404, 'no_points_yet', {});
      }
      return {} as never;
    });
    const me = makeMe();
    providedContext = {
      kind: 'onboarded',
      me: {
        ...me,
        active_membership: { ...me.active_membership, role: 'conductor' },
      } as MeOnboarded,
    };
    wrap(<VehiculosDetalleRoute />);
    expect(await screen.findByText(/el historial lo ve el admin de tu flota/i)).toBeInTheDocument();
    expect(screen.queryByText(/no tenés permiso/i)).toBeNull();
    expect(screen.queryByTestId('hub-resumen')).toBeNull();
    expect(screen.queryByRole('button', { name: /más acciones/i })).toBeNull();
    expect(screen.getByRole('link', { name: /ver en vivo/i })).toHaveAttribute(
      'to',
      '/app/vehiculos/$id/live',
    );
    expect(screen.getByRole('link', { name: /^recorrido$/i })).toHaveAttribute(
      'to',
      '/app/vehiculos/$id/historial',
    );
    expect(get.mock.calls.some((call) => String(call[0]).includes('trayectos-teltonika'))).toBe(
      false,
    );
  });

  it('el despachador conserva el atajo a recorrido y no consulta trayectos', async () => {
    const get = vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/vehiculos/veh-1') {
        return { vehicle: makeVehicleRow({ teltonika_imei: IMEI_VALIDO }) };
      }
      if (path.includes('/ubicacion')) {
        throw new ApiError(404, 'no_points_yet', {});
      }
      return {} as never;
    });
    const me = makeMe();
    providedContext = {
      kind: 'onboarded',
      me: {
        ...me,
        active_membership: { ...me.active_membership, role: 'despachador' },
      } as MeOnboarded,
    };
    wrap(<VehiculosDetalleRoute />);
    expect(await screen.findByText(/el historial lo ve el admin de tu flota/i)).toBeInTheDocument();
    expect(screen.queryByText(/no tenés permiso/i)).toBeNull();
    expect(await screen.findByRole('link', { name: /^recorrido$/i })).toHaveAttribute(
      'to',
      '/app/vehiculos/$id/historial',
    );
    expect(screen.getByRole('link', { name: /ver en vivo/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /ver trayectos/i })).toBeNull();
    expect(get.mock.calls.some((call) => String(call[0]).includes('trayectos-teltonika'))).toBe(
      false,
    );
  });

  it('mientras cargan los trayectos el bloque operativo está ocupado', async () => {
    let resolver: (value: unknown) => void = () => undefined;
    const pendiente = new Promise((resolve) => {
      resolver = resolve;
    });
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/vehiculos/veh-1') {
        return { vehicle: makeVehicleRow({ teltonika_imei: IMEI_VALIDO }) };
      }
      if (path.startsWith('/trayectos-teltonika')) {
        return pendiente;
      }
      if (path.includes('/ubicacion')) {
        throw new ApiError(404, 'no_points_yet', {});
      }
      return {} as never;
    });
    providedContext = { kind: 'onboarded', me: makeMe() };
    wrap(<VehiculosDetalleRoute />);
    const operacion = await screen.findByTestId('hub-operacion');
    expect(operacion).toHaveAttribute('aria-busy', 'true');
    expect(screen.getAllByText('Cargando…').length).toBeGreaterThan(0);
    resolver({
      resumen_vehiculo: {
        ultimo_trayecto: null,
        recientes: [],
        km_recientes: 0,
        litros_recientes: null,
        km_por_litro: null,
        cta_sensor: false,
        alertas_total: 0,
        alerta_ultima: null,
      },
    });
    await waitFor(() => expect(operacion).toHaveAttribute('aria-busy', 'false'));
  });

  it('guardar capacidades deja el hub y confirma sin salir', async () => {
    mockDetalleGet(null);
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({
      vehicle: { ...makeVehicleRow(), capacity_kg: 6000 },
    });
    providedContext = { kind: 'onboarded', me: makeMe() };
    wrap(<VehiculosDetalleRoute />);
    const capacidad = await screen.findByLabelText(/capacidad \(kg\)/i);
    fireEvent.change(capacidad, { target: { value: '6000' } });
    fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }));
    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('AB·CD·12');
    expect(screen.getByText('Cambios guardados.')).toBeInTheDocument();
    expect(screen.getByTestId('hub-vehiculo')).toBeInTheDocument();
  });

  it('retirar solo aparece dentro del menú de más acciones', async () => {
    mockDetalleGet(null);
    providedContext = { kind: 'onboarded', me: makeMe() };
    wrap(<VehiculosDetalleRoute />);
    await screen.findByTestId('hub-vehiculo');
    expect(screen.queryByRole('button', { name: /^retirar$/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /más acciones/i }));
    expect(screen.getByRole('menuitem', { name: /retirar/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: /retirar/i }));
    expect(screen.getByRole('button', { name: /sí, retirar/i })).toBeInTheDocument();
  });

  it('un vehículo retirado no ofrece el menú y la flota dice Retirado', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/vehiculos/veh-1') {
        return { vehicle: makeVehicleRow({ status: 'retirado' }) };
      }
      return {} as never;
    });
    providedContext = { kind: 'onboarded', me: makeMe() };
    wrap(<VehiculosDetalleRoute />);
    expect(await screen.findByTestId('hub-flota')).toHaveTextContent(/retirado/i);
    expect(screen.queryByRole('button', { name: /más acciones/i })).toBeNull();
  });

  it('en mantención la píldora de flota dice Mantención', async () => {
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/vehiculos/veh-1') {
        return { vehicle: makeVehicleRow({ status: 'mantenimiento' }) };
      }
      return {} as never;
    });
    providedContext = { kind: 'onboarded', me: makeMe() };
    wrap(<VehiculosDetalleRoute />);
    expect(await screen.findByTestId('hub-flota')).toHaveTextContent('Mantención');
    expect(screen.getByTestId('hub-flota')).not.toHaveTextContent('Mantenimiento');
  });

  it('si fallan los trayectos, Reintentar vuelve a pedirlos', async () => {
    let fallar = true;
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/vehiculos/veh-1') {
        return { vehicle: makeVehicleRow({ teltonika_imei: IMEI_VALIDO }) };
      }
      if (path.startsWith('/trayectos-teltonika')) {
        if (fallar) {
          throw new Error('red');
        }
        return {
          resumen_vehiculo: {
            ultimo_trayecto: null,
            recientes: [],
            km_recientes: 0,
            litros_recientes: null,
            km_por_litro: null,
            cta_sensor: false,
            alertas_total: 0,
            alerta_ultima: null,
          },
        };
      }
      if (path.includes('/ubicacion')) {
        throw new ApiError(404, 'no_points_yet', {});
      }
      return {} as never;
    });
    providedContext = { kind: 'onboarded', me: makeMe() };
    wrap(<VehiculosDetalleRoute />);
    const reintentar = await screen.findAllByRole('button', { name: /^reintentar$/i });
    const primero = reintentar[0];
    if (!primero) {
      throw new Error('falta el botón Reintentar');
    }
    fallar = false;
    fireEvent.click(primero);
    expect(await screen.findByText(/todavía no hay trayectos en 30 días/i)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /ver en vivo/i }).length).toBeGreaterThan(1);
  });

  it('el mapa del hub mide 160px en un viewport móvil', async () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
    try {
      mockDetalleGet(null);
      providedContext = { kind: 'onboarded', me: makeMe() };
      wrap(<VehiculosDetalleRoute />);
      expect(await screen.findByTestId('hub-mapa-alto')).toHaveAttribute('data-altura', '160');
    } finally {
      window.matchMedia = original;
    }
  });
});
