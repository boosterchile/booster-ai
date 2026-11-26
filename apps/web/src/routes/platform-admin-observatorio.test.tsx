import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

const get = vi.fn();
vi.mock('../lib/api-client.js', () => ({
  api: { get: (...a: unknown[]) => get(...a) },
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public code: string,
      public body: unknown,
    ) {
      super(code);
    }
  },
}));

const { ApiError } = await import('../lib/api-client.js');
const { PlatformAdminObservatorioRoute } = await import('./platform-admin-observatorio.js');

const DATOS = {
  region: 'IV',
  k_min_vehiculos: 10,
  franjas: [
    {
      region: 'IV',
      comuna: '04102',
      mes: '2026-10',
      tipo_dia: 'laboral',
      franja: '09-12',
      clase_vehiculo: 'pesado',
      viajes: 40,
      vehiculos: 12,
    },
  ],
  emisiones: [
    {
      region: 'IV',
      comuna: 'sin_comuna',
      mes: '2026-10',
      clase_vehiculo: 'pesado',
      kgco2e: 1234.5,
      kgco2e_evitado: 210.25,
      viajes: 40,
      vehiculos: 12,
    },
  ],
  od: [],
  activos: [{ region: 'IV', comuna: '04102', mes: '2026-10', viajes: 40, vehiculos: 12 }],
};

function renderRoute() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <PlatformAdminObservatorioRoute />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  get.mockReset();
});

describe('/app/platform-admin/observatorio (T10-24)', () => {
  it('carga Coquimbo (IV) por defecto y muestra las secciones', async () => {
    get.mockResolvedValue(DATOS);
    renderRoute();
    expect(await screen.findByRole('heading', { name: 'Vehículos activos' })).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/admin/observatorio/IV');
    expect(screen.getByRole('combobox', { name: 'Región' })).toHaveValue('IV');
    expect(screen.getByText('09-12')).toBeInTheDocument();
    expect(screen.getByText('1,23 t CO₂e')).toBeInTheDocument();
    expect(screen.getByText('Sin comuna')).toBeInTheDocument();
    expect(screen.getByText(/Cada grupo se muestra desde 1 camión/)).toBeInTheDocument();
    expect(screen.getByTestId('observatorio-od-vacio')).toHaveTextContent(
      'Sin datos en esta región.',
    );
  });

  it('cambiar la región consulta esa región', async () => {
    get.mockResolvedValue(DATOS);
    const user = userEvent.setup();
    renderRoute();
    await screen.findByRole('heading', { name: 'Vehículos activos' });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Región' }), 'XIII');
    expect(get).toHaveBeenLastCalledWith('/admin/observatorio/XIII');
  });

  it('503 → aviso de observatorio no configurado', async () => {
    get.mockRejectedValue(new ApiError(503, 'observatorio_no_configurado', null));
    renderRoute();
    expect(
      await screen.findByText('El observatorio no está configurado en este entorno.'),
    ).toBeInTheDocument();
  });

  it('otro error → aviso genérico', async () => {
    get.mockRejectedValue(new Error('red'));
    renderRoute();
    expect(await screen.findByText('No se pudo cargar el observatorio.')).toBeInTheDocument();
  });

  it('cada fila de Emisiones lleva el sello de su presentación; sin ella, «Estimado»', async () => {
    const fila = DATOS.emisiones[0];
    get.mockResolvedValue({
      ...DATOS,
      emisiones: [
        { ...fila, presentacion: 'primario', kgco2e: 100 },
        { ...fila, presentacion: 'medido_teltonika', kgco2e: 200 },
        { ...fila, kgco2e: 300 },
      ],
    });
    renderRoute();
    await screen.findByRole('heading', { name: 'Emisiones' });
    const tabla = screen.getByRole('heading', { name: 'Emisiones' }).closest('section');
    const filas = [...(tabla?.querySelectorAll('tbody tr') ?? [])];
    const sellos = filas.map((tr) =>
      [...tr.querySelectorAll('[data-cifra-huella]')].map((c) =>
        c.getAttribute('data-presentacion'),
      ),
    );
    expect(sellos).toEqual([
      ['primario', 'primario'],
      ['medido_teltonika', 'medido_teltonika'],
      ['estimado', 'estimado'],
    ]);
  });
});
