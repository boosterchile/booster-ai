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
  EmptyState: ({ title }: { title: string }) => <div data-testid="empty-state">{title}</div>,
  emptyStateActionClass: 'btn',
}));

vi.mock('../components/map/VehicleMap.js', () => ({
  VehicleMap: () => <div data-testid="vehicle-map" />,
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

beforeEach(() => {
  vi.clearAllMocks();
  providedContext = { kind: 'unmanaged' };
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('VehiculosListRoute', () => {
  it('no onboarded → no renderiza', () => {
    const { container } = wrap(<VehiculosListRoute />);
    expect(container.querySelector('[data-testid="layout"]')).toBeNull();
  });

  it('onboarded + lista vacía → mensaje "Aún no tienes vehículos"', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({ vehicles: [] });
    providedContext = { kind: 'onboarded', me: makeMe() };
    wrap(<VehiculosListRoute />);
    await waitFor(() => expect(screen.getByText(/Aún no tienes vehículos/)).toBeInTheDocument());
  });

  it('onboarded + vehículos → renderiza plate', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      vehicles: [
        {
          id: 'v1',
          plate: 'ABCD12',
          type: 'camion_pequeno',
          capacity_kg: 5000,
          capacity_m3: null,
          year: 2020,
          brand: null,
          model: null,
          fuel_type: 'diesel',
          curb_weight_kg: null,
          consumption_l_per_100km_baseline: null,
          teltonika_imei: null,
          rut: null,
          status: 'activo',
          available_for_assignment: true,
          notes: null,
          created_at: '2026-05-10T10:00:00Z',
        },
      ],
    });
    providedContext = { kind: 'onboarded', me: makeMe() };
    wrap(<VehiculosListRoute />);
    // formatPlateForDisplay puede insertar espacios/separadores; basta verificar
    // que el dígito de patente quede visible en la página.
    await waitFor(() =>
      expect(
        screen.getAllByText((_t, n) => n?.textContent?.includes('AB·CD·12') ?? false).length,
      ).toBeGreaterThan(0),
    );
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

function makeVehicleRow(overrides: Partial<{ teltonika_imei: string | null }> = {}) {
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
  it('sin IMEI → muestra "Sin dispositivo" y sin link de ubicación en vivo', async () => {
    mockDetalleGet(null);
    providedContext = { kind: 'onboarded', me: makeMe() };
    wrap(<VehiculosDetalleRoute />);
    await waitFor(() => expect(screen.getByText(/sin dispositivo/i)).toBeInTheDocument());
    expect(screen.queryByText(/ver en vivo/i)).toBeNull();
  });

  it('con IMEI → muestra el IMEI actual y el link a ubicación en vivo', async () => {
    mockDetalleGet(IMEI_VALIDO);
    providedContext = { kind: 'onboarded', me: makeMe() };
    wrap(<VehiculosDetalleRoute />);
    await waitFor(() => expect(screen.getAllByText(IMEI_VALIDO).length).toBeGreaterThan(0));
    expect(screen.getByText(/ver en vivo/i)).toBeInTheDocument();
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
    await waitFor(() => expect(screen.getByText(/sin dispositivo/i)).toBeInTheDocument());
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
