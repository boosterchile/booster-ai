import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

const { AdminDispositivosRoute } = await import('./admin-dispositivos.js');

function makeMe(role: 'dueno' | 'admin' | 'conductor'): MeOnboarded {
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
        legal_name: 'E',
        rut: '76',
        is_generador_carga: false,
        is_transportista: true,
        status: 'activa',
      },
    } as MeOnboarded['active_membership'],
  } as MeOnboarded;
}

function makeWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function renderRoute() {
  const Wrapper = makeWrapper();
  return render(
    <Wrapper>
      <AdminDispositivosRoute />
    </Wrapper>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  providedContext = { kind: 'unmanaged' };
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('AdminDispositivosRoute', () => {
  it('no onboarded → no renderiza', () => {
    const { container } = renderRoute();
    expect(container.querySelector('[data-testid="layout"]')).toBeNull();
  });

  it('rol conductor → "Acceso restringido"', () => {
    providedContext = { kind: 'onboarded', me: makeMe('conductor') };
    renderRoute();
    expect(screen.getByText('Acceso restringido')).toBeInTheDocument();
  });

  it('rol admin → renderiza Layout', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ devices: [], vehicles: [] });
    providedContext = { kind: 'onboarded', me: makeMe('admin') };
    renderRoute();
    await waitFor(() => expect(screen.getByTestId('layout')).toBeInTheDocument());
  });

  it('al abrir no consulta la bandeja global', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ vehicles: [] });
    providedContext = { kind: 'onboarded', me: makeMe('dueno') };
    renderRoute();
    await waitFor(() => expect(screen.getByLabelText(/IMEI/i)).toBeInTheDocument());
    const paths = get.mock.calls.map((call) => String(call[0]));
    expect(paths.some((path) => path.includes('/admin/dispositivos-pendientes'))).toBe(false);
    expect(screen.queryByTestId('empty-state')).toBeNull();
  });

  it('busca el IMEI tipeado y no muestra la IP ni Rechazar', async () => {
    const imei = '356307042441013';
    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path.includes('/admin/dispositivos-pendientes')) {
        expect(path).toContain(`imei=${imei}`);
        return {
          devices: [
            {
              id: 'd1',
              imei,
              primera_conexion_en: '2026-05-10T10:00:00Z',
              ultima_conexion_en: '2026-05-10T10:05:00Z',
              cantidad_conexiones: 3,
              modelo_detectado: 'FMC150',
              estado: 'pendiente',
            },
          ],
        };
      }
      if (path === '/vehiculos') {
        return { vehicles: [{ id: 'v1', plate: 'XYZ123', brand: 'Volvo', model: 'FH' }] };
      }
      return {};
    });
    providedContext = { kind: 'onboarded', me: makeMe('dueno') };
    renderRoute();
    fireEvent.change(screen.getByLabelText(/IMEI/i), { target: { value: imei } });
    fireEvent.click(screen.getByRole('button', { name: /Buscar/i }));
    await waitFor(() => expect(screen.getByText(imei)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Rechazar/i })).toBeNull();
    expect(screen.queryByText(/1\.2\.3\.4/)).toBeNull();
  });
});
