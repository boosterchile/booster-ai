import type { PanelBoosterFleet } from '@booster-ai/shared-schemas';
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
}));

vi.mock('../components/Layout.js', () => ({
  Layout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const { BoosterFleetRoute } = await import('./booster-fleet.js');

const VEHICULO = '11111111-1111-4111-8111-111111111111';
const CONDUCTOR = '55555555-5555-4555-8555-555555555555';
const MANTENCION = '33333333-3333-4333-8333-333333333333';

function me(rol: 'dueno' | 'admin' | 'despachador' = 'dueno', transportista = true): MeOnboarded {
  return {
    needs_onboarding: false,
    user: { id: 'u', full_name: 'Dueño' } as MeOnboarded['user'],
    memberships: [],
    active_membership: {
      id: 'm',
      role: rol,
      status: 'activa',
      joined_at: null,
      empresa: {
        id: 'e',
        legal_name: 'Transportes Demo',
        rut: '76.123.456-7',
        is_generador_carga: false,
        is_transportista: transportista,
        status: 'activa',
      },
    },
  } as MeOnboarded;
}

function panel(): PanelBoosterFleet {
  return {
    configuracion: {
      slug: 'booster-fleet',
      nombre: 'Booster Fleet',
      servicio: 'gestion_de_flota',
      audiencia: 'dueno_transportista',
      ventana_combustible_dias: 7,
    },
    combustible: {
      desde: '2026-11-10T15:00:00.000Z',
      hasta: '2026-11-17T15:00:00.000Z',
      truncado: true,
      litros: 30,
      km: 100,
      litros_por_100_km: 30,
      con_alerta: 1,
      vehiculos: [
        {
          vehiculo_id: VEHICULO,
          patente: 'AAAA11',
          senal: 'posible_robo',
          litros: 30,
          km: 100,
          litros_por_100_km: 30,
          alertas: ['golpe'],
        },
      ],
    },
    documental: {
      vehiculos_al_dia: 0,
      vehiculos_con_hallazgo: 1,
      conductores_al_dia: 0,
      conductores_con_hallazgo: 1,
      vehiculos: [
        {
          vehiculo_id: VEHICULO,
          patente: 'AAAA11',
          al_dia: false,
          estado: 'faltante',
          documentos: [
            {
              tipo: 'revision_tecnica',
              estado: 'faltante',
              fecha_vencimiento: null,
              archivo: false,
            },
            {
              tipo: 'permiso_circulacion',
              estado: 'vigente',
              fecha_vencimiento: '2027-01-01',
              archivo: true,
            },
            { tipo: 'soap', estado: 'vigente', fecha_vencimiento: '2027-01-01', archivo: true },
          ],
        },
      ],
      conductores: [
        {
          conductor_id: CONDUCTOR,
          nombre: 'Ana Soto',
          rut: '',
          al_dia: false,
          estado: 'sin_archivo',
          documentos: [
            {
              tipo: 'licencia_conducir',
              estado: 'sin_archivo',
              fecha_vencimiento: '2027-01-01',
              archivo: false,
            },
          ],
        },
      ],
    },
    mantenciones: {
      vencidas: 1,
      proximas: 0,
      programadas: 0,
      truncadas: true,
      en_taller: [{ vehiculo_id: VEHICULO, patente: 'AAAA11' }],
      items: [
        {
          id: MANTENCION,
          vehiculo_id: VEHICULO,
          patente: 'AAAA11',
          tipo: 'preventiva',
          titulo: 'Cambio de aceite',
          programada_para: '2026-11-01',
          kilometraje_objetivo: null,
          estado: 'vencida',
          realizada_en: null,
          notas: 'taller sur',
        },
      ],
    },
  };
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

describe('BoosterFleetRoute', () => {
  it('sin sesión no muestra el panel', () => {
    wrap(<BoosterFleetRoute />);
    expect(screen.queryByText('Booster Fleet')).not.toBeInTheDocument();
  });

  it('un despachador ve que el control es del dueño', () => {
    providedContext = { kind: 'onboarded', me: me('despachador') };
    wrap(<BoosterFleetRoute />);
    expect(screen.getByText(/control de flota del dueño/)).toBeInTheDocument();
  });

  it('muestra combustible, documentos y mantenciones', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(panel());
    providedContext = { kind: 'onboarded', me: me() };
    wrap(<BoosterFleetRoute />);
    expect(await screen.findByText('Desviación de combustible por analizar')).toBeInTheDocument();
    expect(screen.getByText('Revisión técnica: Falta el documento')).toBeInTheDocument();
    expect(screen.getByText(/Ana Soto · Sin RUT/)).toBeInTheDocument();
    expect(screen.getByText(/Cambio de aceite/)).toBeInTheDocument();
    expect(screen.getByText(/ventana de telemetría vino cortada/)).toBeInTheDocument();
    expect(screen.getByText(/En taller: AAAA11/)).toBeInTheDocument();
    expect(screen.getByText(/más mantenciones/)).toBeInTheDocument();
  });

  it('una respuesta mal formada se muestra como error', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ no: 'es' });
    providedContext = { kind: 'onboarded', me: me('admin') };
    wrap(<BoosterFleetRoute />);
    expect(await screen.findByText(/no tiene la forma esperada/)).toBeInTheDocument();
  });

  it('un error del API se muestra', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new ApiError(500, 'error', {}, 'falló el panel'));
    providedContext = { kind: 'onboarded', me: me() };
    wrap(<BoosterFleetRoute />);
    expect(await screen.findByText('falló el panel')).toBeInTheDocument();
  });

  it('programa una mantención y marca una como realizada', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue(panel());
    const post = vi.spyOn(api, 'post').mockResolvedValue({ mantencion: {} });
    providedContext = { kind: 'onboarded', me: me() };
    const user = userEvent.setup();
    wrap(<BoosterFleetRoute />);
    await screen.findByText('Desviación de combustible por analizar');
    await user.type(screen.getByLabelText('Qué hay que hacer'), 'Cambio de filtro');
    await user.click(screen.getByRole('button', { name: 'Programar mantención' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0]?.[0]).toBe('/booster-fleet/mantenciones');
    await user.click(screen.getByRole('button', { name: 'Marcar realizada' }));
    await waitFor(() =>
      expect(post.mock.calls.some((call) => String(call[0]).endsWith('/realizar'))).toBe(true),
    );
    expect(get.mock.calls.length).toBeGreaterThan(1);
  });

  it('cancelar pide confirmación y muestra el error si el API falla', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(panel());
    vi.spyOn(api, 'post').mockRejectedValue(new Error('no se pudo'));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    providedContext = { kind: 'onboarded', me: me() };
    const user = userEvent.setup();
    wrap(<BoosterFleetRoute />);
    await screen.findByText(/Cambio de aceite/);
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(await screen.findByText('no se pudo')).toBeInTheDocument();
  });

  it('una flota vacía muestra los vacíos y un alta fallida', async () => {
    const vacio = panel();
    vacio.combustible.vehiculos = [];
    vacio.combustible.litros_por_100_km = null;
    vacio.combustible.truncado = false;
    vacio.documental.vehiculos = [];
    vacio.documental.conductores = [];
    vacio.mantenciones.items = [];
    vacio.mantenciones.truncadas = false;
    vacio.mantenciones.en_taller = [];
    vi.spyOn(api, 'get').mockResolvedValue(vacio);
    providedContext = { kind: 'onboarded', me: me() };
    wrap(<BoosterFleetRoute />);
    expect(await screen.findByText('Todavía no hay vehículos en la flota.')).toBeInTheDocument();
    expect(screen.getByText('Vehículos: no hay registros.')).toBeInTheDocument();
    expect(screen.getByText('Conductores: no hay registros.')).toBeInTheDocument();
    expect(screen.getByText('No hay mantenciones abiertas ni recientes.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Programar mantención' })).toBeDisabled();
  });

  it('si programar falla, muestra el mensaje', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(panel());
    vi.spyOn(api, 'post').mockRejectedValueOnce(new Error('no se guardó'));
    providedContext = { kind: 'onboarded', me: me() };
    const user = userEvent.setup();
    wrap(<BoosterFleetRoute />);
    await screen.findByLabelText('Qué hay que hacer');
    await user.type(screen.getByLabelText('Qué hay que hacer'), 'Cambio de filtro');
    await user.type(screen.getByLabelText(/Kilometraje objetivo/), '120000');
    await user.click(screen.getByRole('button', { name: 'Programar mantención' }));
    expect(await screen.findByText('no se guardó')).toBeInTheDocument();
  });

  it('un error que no es Error usa el mensaje genérico', async () => {
    vi.spyOn(api, 'get').mockRejectedValue('caido');
    providedContext = { kind: 'onboarded', me: me() };
    wrap(<BoosterFleetRoute />);
    expect(await screen.findByText('No se pudo completar la acción.')).toBeInTheDocument();
  });

  it('sin confirmar no cancela', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(panel());
    const post = vi.spyOn(api, 'post').mockResolvedValue({});
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    providedContext = { kind: 'onboarded', me: me() };
    const user = userEvent.setup();
    wrap(<BoosterFleetRoute />);
    await screen.findByRole('button', { name: 'Cancelar' });
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(post).not.toHaveBeenCalled();
  });
});
