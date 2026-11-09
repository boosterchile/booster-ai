import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  useParams: () => ({ id: 'trip-1' }),
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

const { CargasListRoute, CargasNuevoRoute, CargasDetalleRoute } = await import('./cargas.js');

// jsdom no implementa scrollIntoView. useScrollToFirstError lo llama al
// submit con errores y, sin stub, desmonta el árbol del test.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => undefined;
}

function makeMe(isShipper: boolean): MeOnboarded {
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
        is_generador_carga: isShipper,
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

beforeEach(() => {
  vi.clearAllMocks();
  providedContext = { kind: 'unmanaged' };
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('CargasListRoute', () => {
  it('no onboarded → no renderiza', () => {
    const { container } = wrap(<CargasListRoute />);
    expect(container.querySelector('[data-testid="layout"]')).toBeNull();
  });

  it('no shipper → "Sin permisos"', () => {
    providedContext = { kind: 'onboarded', me: makeMe(false) };
    wrap(<CargasListRoute />);
    expect(screen.getByText(/generador de carga/i)).toBeInTheDocument();
  });

  it('shipper + lista vacía → mensaje "No tienes cargas activas"', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({ trip_requests: [] });
    providedContext = { kind: 'onboarded', me: makeMe(true) };
    wrap(<CargasListRoute />);
    await waitFor(() => expect(screen.getByText('No tienes cargas activas')).toBeInTheDocument());
  });

  it('shipper + lista con un trip → renderiza tracking code', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      trip_requests: [
        {
          id: 't1',
          tracking_code: 'BST-001',
          status: 'esperando_match',
          origin_address_raw: 'Av X',
          origin_region_code: 'XIII',
          destination_address_raw: 'Av Y',
          destination_region_code: 'V',
          cargo_type: 'carga_seca',
          cargo_weight_kg: 5000,
          cargo_volume_m3: null,
          pickup_window_start: null,
          pickup_window_end: null,
          created_at: '2026-05-10T10:00:00Z',
        },
      ],
    });
    providedContext = { kind: 'onboarded', me: makeMe(true) };
    wrap(<CargasListRoute />);
    await waitFor(() => expect(screen.getAllByText(/BST-001/).length).toBeGreaterThan(0));
  });
});

describe('CargasNuevoRoute', () => {
  it('no onboarded → no renderiza', () => {
    const { container } = wrap(<CargasNuevoRoute />);
    expect(container.querySelector('[data-testid="layout"]')).toBeNull();
  });

  it('no shipper → "Sin permisos"', () => {
    providedContext = { kind: 'onboarded', me: makeMe(false) };
    wrap(<CargasNuevoRoute />);
    expect(screen.getByText(/Sin permisos|no opera como generador/i)).toBeInTheDocument();
  });

  it('shipper → renderiza Layout con form', () => {
    providedContext = { kind: 'onboarded', me: makeMe(true) };
    wrap(<CargasNuevoRoute />);
    expect(screen.getByTestId('layout')).toBeInTheDocument();
  });

  it('al enviar vacío muestra dirección, región y fecha juntas', async () => {
    const user = userEvent.setup();
    providedContext = { kind: 'onboarded', me: makeMe(true) };
    wrap(<CargasNuevoRoute />);
    await user.click(screen.getByRole('button', { name: 'Crear carga' }));
    expect(await screen.findAllByText('Selecciona una fecha y hora')).toHaveLength(2);
    expect(screen.getAllByText('Ingresa una dirección (mínimo 5 caracteres)')).toHaveLength(2);
    expect(screen.getAllByText('Selecciona una región')).toHaveLength(2);
    expect(screen.getByText('Ingresa el peso en kg')).toBeInTheDocument();
  });

  it('Compañía 4425 con región y comuna no marca la dirección como inválida', async () => {
    const user = userEvent.setup();
    providedContext = { kind: 'onboarded', me: makeMe(true) };
    wrap(<CargasNuevoRoute />);
    await user.type(screen.getByLabelText(/Dirección de recogida/), 'Compañía 4425');
    const region = screen.getAllByLabelText(/Región/)[0];
    const comuna = screen.getAllByLabelText('Comuna')[0];
    if (!region || !comuna) {
      throw new Error('faltan los selectores de región y comuna');
    }
    await user.selectOptions(region, 'XIII');
    await user.selectOptions(comuna, '13101');
    await user.click(screen.getByRole('button', { name: 'Crear carga' }));
    expect(screen.getAllByText('Ingresa una dirección (mínimo 5 caracteres)')).toHaveLength(1);
    expect(region).toHaveValue('XIII');
    expect(comuna).toHaveValue('13101');
  });

  it('después de un envío vacío, corregir los campos publica la carga', async () => {
    const user = userEvent.setup();
    const post = vi.spyOn(api, 'post').mockResolvedValue({
      trip_request: { id: '11111111-1111-4111-8111-111111111111' },
    });
    providedContext = { kind: 'onboarded', me: makeMe(true) };
    wrap(<CargasNuevoRoute />);
    await user.click(screen.getByRole('button', { name: 'Crear carga' }));
    expect(await screen.findAllByText('Selecciona una región')).toHaveLength(2);
    // useScrollToFirstError enfoca el primer error (Desde) 50 ms después del
    // submit. Si el tipeo arranca antes, ese foco se roba a mitad de la
    // dirección y el envío corregido no llega a publicarse.
    await waitFor(() => {
      expect(screen.getByLabelText(/Desde/)).toHaveFocus();
    });

    await user.type(screen.getByLabelText(/Dirección de recogida/), 'Av. Apoquindo 5550');
    await user.type(screen.getByLabelText(/Dirección de entrega/), 'Av. Pajaritos 3000');
    const regiones = screen.getAllByLabelText(/Región/);
    const origen = regiones[0];
    const destino = regiones[1];
    if (!origen || !destino) {
      throw new Error('faltan los selectores de región');
    }
    await user.selectOptions(origen, 'XIII');
    await user.selectOptions(destino, 'VIII');
    await user.type(screen.getByLabelText(/Peso/), '8000');
    const local = (fecha: Date) => {
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${fecha.getFullYear()}-${pad(fecha.getMonth() + 1)}-${pad(fecha.getDate())}T${pad(fecha.getHours())}:${pad(fecha.getMinutes())}`;
    };
    fireEvent.change(screen.getByLabelText(/Desde/), {
      target: { value: local(new Date(Date.now() + 2 * 60 * 60 * 1000)) },
    });
    fireEvent.change(screen.getByLabelText(/Hasta/), {
      target: { value: local(new Date(Date.now() + 6 * 60 * 60 * 1000)) },
    });
    await user.click(screen.getByRole('button', { name: 'Crear carga' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
  });
});

// seguimiento-por-correo: correo opcional del destinatario en el formulario.
describe('CargasNuevoRoute — correo del destinatario', () => {
  /**
   * Clic + pegar en vez de `user.type`: el formulario se re-renderiza entero en
   * cada tecla (`watch()`) y, tecla a tecla, este caso pasaba de los 5 s bajo
   * cobertura en CI. Pegar dispara un solo input con el texto completo.
   */
  async function escribir(
    user: ReturnType<typeof userEvent.setup>,
    campo: HTMLElement,
    texto: string,
  ) {
    await user.click(campo);
    await user.paste(texto);
  }

  async function llenarCargaValida(user: ReturnType<typeof userEvent.setup>) {
    await escribir(user, screen.getByLabelText(/Dirección de recogida/), 'Av. Apoquindo 5550');
    await escribir(user, screen.getByLabelText(/Dirección de entrega/), 'Av. Pajaritos 3000');
    const [origen, destino] = screen.getAllByLabelText(/Región/);
    if (!origen || !destino) {
      throw new Error('faltan los selectores de región');
    }
    await user.selectOptions(origen, 'XIII');
    await user.selectOptions(destino, 'VIII');
    await escribir(user, screen.getByLabelText(/Peso/), '8000');
    const local = (fecha: Date) => {
      const pad = (n: number) => String(n).padStart(2, '0');
      return `${fecha.getFullYear()}-${pad(fecha.getMonth() + 1)}-${pad(fecha.getDate())}T${pad(fecha.getHours())}:${pad(fecha.getMinutes())}`;
    };
    fireEvent.change(screen.getByLabelText(/Desde/), {
      target: { value: local(new Date(Date.now() + 2 * 60 * 60 * 1000)) },
    });
    fireEvent.change(screen.getByLabelText(/Hasta/), {
      target: { value: local(new Date(Date.now() + 6 * 60 * 60 * 1000)) },
    });
  }

  it('manda el correo del destinatario junto al nombre', async () => {
    const user = userEvent.setup();
    const post = vi.spyOn(api, 'post').mockResolvedValue({
      trip_request: { id: '11111111-1111-4111-8111-111111111111' },
    });
    providedContext = { kind: 'onboarded', me: makeMe(true) };
    wrap(<CargasNuevoRoute />);
    await llenarCargaValida(user);
    await escribir(user, screen.getByLabelText(/Nombre del destinatario/), 'Bodega La Serena');
    await escribir(user, screen.getByLabelText(/Correo del destinatario/), 'Recepcion@Cliente.CL');
    await escribir(user, screen.getByLabelText(/Notas para el transportista/), 'Andén 4');
    await escribir(user, screen.getByLabelText(/^Referencia/), 'PO-1');
    await user.click(screen.getByRole('button', { name: 'Crear carga' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    const [, body] = post.mock.calls[0] as [
      string,
      { consignee?: unknown; notes?: string; reference?: string },
    ];
    // editar-anular-cargas §12-P4: notas y referencia al crear.
    expect(body.notes).toBe('Andén 4');
    expect(body.reference).toBe('PO-1');
    // El API lo guarda en minúsculas (schema compartido); la web lo manda tal cual, sin espacios.
    expect(body.consignee).toEqual({ name: 'Bodega La Serena', email: 'Recepcion@Cliente.CL' });
  });

  it('un correo inválido muestra el mensaje bajo el campo y no publica', async () => {
    const user = userEvent.setup();
    const post = vi.spyOn(api, 'post');
    providedContext = { kind: 'onboarded', me: makeMe(true) };
    wrap(<CargasNuevoRoute />);
    await llenarCargaValida(user);
    await escribir(user, screen.getByLabelText(/Correo del destinatario/), 'no-es-correo');
    await user.click(screen.getByRole('button', { name: 'Crear carga' }));
    expect(
      await screen.findByText('Ingresa un correo válido, como nombre@empresa.cl'),
    ).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });
});

describe('CargasDetalleRoute', () => {
  it('no onboarded → no renderiza', () => {
    const { container } = wrap(<CargasDetalleRoute />);
    expect(container.querySelector('[data-testid="layout"]')).toBeNull();
  });

  it('onboarded + GET ok → renderiza con tracking_code', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      trip_request: {
        id: 'trip-1',
        tracking_code: 'BST-999',
        status: 'esperando_match',
        origin_address_raw: 'A',
        origin_region_code: 'XIII',
        destination_address_raw: 'B',
        destination_region_code: 'V',
        cargo_type: 'carga_seca',
        cargo_weight_kg: 5000,
        cargo_volume_m3: null,
        pickup_window_start: null,
        pickup_window_end: null,
        created_at: '2026-05-10T10:00:00Z',
      },
      events: [],
      assignment: null,
      metrics: null,
    });
    providedContext = { kind: 'onboarded', me: makeMe(true) };
    wrap(<CargasDetalleRoute />);
    await waitFor(() => expect(screen.getAllByText(/BST-999/).length).toBeGreaterThan(0));
  });

  // editar-anular-cargas §9: «Contacto y notas» en el detalle.
  it.each([
    [true, true],
    [false, false],
  ])('datos libres permitidos=%s → botón Editar visible=%s', async (permitido, visible) => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      trip_request: {
        id: 'trip-1',
        tracking_code: 'BST-999',
        status: permitido ? 'asignado' : 'entregado',
        origin_address_raw: 'A',
        origin_region_code: 'XIII',
        destination_address_raw: 'B',
        destination_region_code: 'V',
        cargo_type: 'carga_seca',
        cargo_weight_kg: 5000,
        cargo_volume_m3: null,
        pickup_window_start: null,
        pickup_window_end: null,
        created_at: '2026-05-10T10:00:00Z',
        consignee: { name: 'Bodega', phone_e164: null, email: null },
        notes: 'Andén 4',
        reference: 'PO-1',
        acciones_permitidas: { editar_datos_libres: permitido },
      },
      events: [],
      assignment: null,
      metrics: null,
    });
    providedContext = { kind: 'onboarded', me: makeMe(true) };
    wrap(<CargasDetalleRoute />);
    expect(await screen.findByText('Contacto y notas')).toBeInTheDocument();
    expect(screen.getByText('Andén 4')).toBeInTheDocument();
    expect(screen.getByText('PO-1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar' }) !== null).toBe(visible);
  });

  // editar-anular-cargas §9: anular antes del match, cancelar después.
  const tripBase = {
    id: 'trip-1',
    tracking_code: 'BST-999',
    origin_address_raw: 'A',
    origin_region_code: 'XIII',
    destination_address_raw: 'B',
    destination_region_code: 'V',
    cargo_type: 'carga_seca',
    cargo_weight_kg: 5000,
    cargo_volume_m3: null,
    pickup_window_start: null,
    pickup_window_end: null,
    created_at: '2026-05-10T10:00:00Z',
  };

  it('antes del match ofrece «Anular carga» y no «Cancelar servicio»', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      trip_request: {
        ...tripBase,
        status: 'ofertas_enviadas',
        acciones_permitidas: { editar_datos_libres: true, anular: true, cancelar: false },
      },
      events: [],
      assignment: null,
      metrics: null,
    });
    providedContext = { kind: 'onboarded', me: makeMe(true) };
    wrap(<CargasDetalleRoute />);
    expect(await screen.findByRole('button', { name: 'Anular carga' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancelar servicio' })).not.toBeInTheDocument();
  });

  it('asignado ofrece «Cancelar servicio» con el teléfono del conductor', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      trip_request: {
        ...tripBase,
        status: 'asignado',
        acciones_permitidas: { editar_datos_libres: true, anular: false, cancelar: true },
      },
      events: [],
      assignment: {
        id: 'a1',
        status: 'asignado',
        agreed_price_clp: 1000,
        accepted_at: '2026-05-10T11:00:00Z',
        picked_up_at: null,
        delivered_at: null,
        cancelled_at: null,
        empresa_id: 'e2',
        empresa_legal_name: 'Transportes Sur',
        vehicle_id: null,
        vehicle_plate: null,
        vehicle_type: null,
        driver_user_id: 'u-c',
        driver_name: 'Conductor Uno',
        conductor_telefono_e164: '+56977777777',
        ubicacion_actual: null,
      },
      metrics: null,
    });
    providedContext = { kind: 'onboarded', me: makeMe(true) };
    wrap(<CargasDetalleRoute />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar servicio' }));
    expect(screen.getByText(/llama al conductor: \+56977777777/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Anular carga' })).not.toBeInTheDocument();
  });

  it('sin acciones de baja (en_proceso) no ofrece anular ni cancelar', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      trip_request: {
        ...tripBase,
        status: 'en_proceso',
        acciones_permitidas: { editar_datos_libres: true, anular: false, cancelar: false },
      },
      events: [],
      assignment: null,
      metrics: null,
    });
    providedContext = { kind: 'onboarded', me: makeMe(true) };
    wrap(<CargasDetalleRoute />);
    await waitFor(() => expect(screen.getAllByText(/BST-999/).length).toBeGreaterThan(0));
    expect(screen.queryByRole('button', { name: 'Anular carga' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancelar servicio' })).not.toBeInTheDocument();
  });

  // editar-anular-cargas §9: cambios después del match.
  it('asignado sin cambio pendiente ofrece «Solicitar cambio» y abre el formulario', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      trip_request: {
        ...tripBase,
        status: 'asignado',
        acciones_permitidas: {
          editar_datos_libres: true,
          solicitar_cambio: true,
          retirar_cambio: false,
          anular: false,
          cancelar: true,
        },
        cambio_pendiente: null,
      },
      events: [],
      assignment: null,
      metrics: null,
    });
    providedContext = { kind: 'onboarded', me: makeMe(true) };
    wrap(<CargasDetalleRoute />);
    fireEvent.click(await screen.findByRole('button', { name: 'Solicitar cambio' }));
    expect(screen.getByRole('form', { name: 'Solicitar cambio' })).toBeInTheDocument();
  });

  it('con un cambio pendiente muestra el aviso con «Retirar solicitud» y no ofrece otro', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      trip_request: {
        ...tripBase,
        status: 'asignado',
        acciones_permitidas: {
          editar_datos_libres: true,
          solicitar_cambio: false,
          retirar_cambio: true,
          anular: false,
          cancelar: true,
        },
        cambio_pendiente: {
          id: 'sol-1',
          cambios: { weight_kg: 2500 },
          valores_anteriores: { weight_kg: 5000 },
          creado_en: '2026-11-09T15:00:00.000Z',
        },
      },
      events: [],
      assignment: null,
      metrics: null,
    });
    providedContext = { kind: 'onboarded', me: makeMe(true) };
    wrap(<CargasDetalleRoute />);
    expect(
      await screen.findByText('Cambio pendiente de aprobación del transportista'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retirar solicitud' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Solicitar cambio' })).not.toBeInTheDocument();
  });

  it('en proceso explica que la carga ya fue recogida', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      trip_request: {
        ...tripBase,
        status: 'en_proceso',
        acciones_permitidas: { editar_datos_libres: true, solicitar_cambio: false },
      },
      events: [],
      assignment: null,
      metrics: null,
    });
    providedContext = { kind: 'onboarded', me: makeMe(true) };
    wrap(<CargasDetalleRoute />);
    expect(await screen.findByText(/La carga ya fue recogida/)).toBeInTheDocument();
  });

  it('una carga anulada muestra quién y cuándo', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      trip_request: {
        ...tripBase,
        status: 'cancelado',
        acciones_permitidas: { editar_datos_libres: false, anular: false, cancelar: false },
        anulacion: { en: '2026-11-09T16:00:00Z', por_nombre: 'Ana Pérez', razon: null },
        cancelacion: null,
      },
      events: [],
      assignment: null,
      metrics: null,
    });
    providedContext = { kind: 'onboarded', me: makeMe(true) };
    wrap(<CargasDetalleRoute />);
    expect(await screen.findByText(/Anulada el .* por Ana Pérez\./)).toBeInTheDocument();
  });

  it('en_proceso sin destinatario y con token → muestra el enlace público', async () => {
    const token = '550e8400-e29b-4114-a716-446655440000';
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      trip_request: {
        id: 'trip-1',
        tracking_code: 'BOO-PMGQWN',
        status: 'en_proceso',
        origin_address_raw: 'A',
        origin_region_code: 'XIII',
        destination_address_raw: 'B',
        destination_region_code: 'V',
        cargo_type: 'carga_seca',
        cargo_weight_kg: 5000,
        cargo_volume_m3: null,
        pickup_window_start: null,
        pickup_window_end: null,
        created_at: '2026-05-10T10:00:00Z',
      },
      events: [],
      assignment: {
        id: 'a1',
        status: 'en_proceso',
        agreed_price_clp: 1000,
        accepted_at: '2026-05-10T11:00:00Z',
        picked_up_at: null,
        delivered_at: null,
        cancelled_at: null,
        empresa_id: 'e2',
        empresa_legal_name: 'Van Oosterwyk',
        vehicle_id: 'v1',
        vehicle_plate: 'ABCD12',
        vehicle_type: 'camion',
        driver_user_id: null,
        driver_name: null,
        ubicacion_actual: null,
        public_tracking_token: token,
      },
      metrics: null,
    });
    providedContext = { kind: 'onboarded', me: makeMe(true) };
    wrap(<CargasDetalleRoute />);
    const link = await screen.findByRole('link', { name: /seguimiento público/i });
    expect(link).toHaveAttribute('href', `http://localhost:3000/tracking/${token}`);
  });

  it('con métricas → muestra «Método de cálculo» con la línea que entrega el API (ADR-077 §4)', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      trip_request: {
        id: 'trip-1',
        tracking_code: 'BST-999',
        status: 'entregado',
        origin_address_raw: 'A',
        origin_region_code: 'XIII',
        destination_address_raw: 'B',
        destination_region_code: 'V',
        cargo_type: 'carga_seca',
        cargo_weight_kg: 5000,
        cargo_volume_m3: null,
        pickup_window_start: null,
        pickup_window_end: null,
        created_at: '2026-05-10T10:00:00Z',
      },
      events: [],
      assignment: null,
      metrics: {
        distance_km_estimated: '120.00',
        distance_km_actual: '118.30',
        carbon_emissions_kgco2e_estimated: '40.000',
        carbon_emissions_kgco2e_actual: '39.120',
        precision_method: 'modelado',
        glec_version: 'v3.0',
        route_data_source: 'movil_gps',
        coverage_pct: '96.40',
        certification_level: 'secundario_modeled',
        linea_metodo:
          'Distancia medida por GPS del celular del conductor (cobertura 96 %) · Consumo modelado según GLEC v3.0',
        certificate_pdf_url: null,
        certificate_sha256: null,
        certificate_kms_key_version: null,
        certificate_issued_at: null,
      },
    });
    providedContext = { kind: 'onboarded', me: makeMe(true) };
    wrap(<CargasDetalleRoute />);
    expect(await screen.findByText('Método de cálculo')).toBeInTheDocument();
    expect(
      screen.getByText(/GPS del celular del conductor \(cobertura 96 %\)/),
    ).toBeInTheDocument();
  });
});
