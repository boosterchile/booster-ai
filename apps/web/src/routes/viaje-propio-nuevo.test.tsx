import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeResponse } from '../hooks/use-me.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...props }: { children: ReactNode; to?: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
}));

let providedContext: { kind: string; me?: MeOnboarded } = { kind: 'unmanaged' };
vi.mock('../components/ProtectedRoute.js', () => ({
  ProtectedRoute: ({ children }: { children: (ctx: unknown) => ReactNode }) =>
    children(providedContext),
}));
vi.mock('../components/Layout.js', () => ({
  Layout: ({ children, title }: { children: ReactNode; title?: string }) => (
    <main data-testid="layout" data-title={title}>
      {children}
    </main>
  ),
}));
vi.mock('../components/lugar/SelectorLugar.js', () => ({
  SelectorLugar: () => <div data-testid="selector-lugar-mock" />,
}));

vi.mock('../lib/api-client.js', async () => {
  const actual =
    await vi.importActual<typeof import('../lib/api-client.js')>('../lib/api-client.js');
  return {
    ...actual,
    api: {
      ...actual.api,
      post: vi.fn(),
    },
  };
});

const { ViajePropioNuevoRoute } = await import('./viaje-propio-nuevo.js');

function makeMe(over: { role?: string; transportista?: boolean } = {}): MeOnboarded {
  return {
    needs_onboarding: false,
    user: { id: 'u1', email: 'jefa@x.cl', full_name: 'Jefa', rut: '11111111-1' },
    memberships: [],
    active_membership: {
      role: over.role ?? 'despachador',
      empresa: {
        id: 'e1',
        legal_name: 'Transportes X',
        is_transportista: over.transportista ?? true,
        is_generador_carga: false,
      },
    },
  } as unknown as MeOnboarded;
}

function renderRoute() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ViajePropioNuevoRoute />
    </QueryClientProvider>,
  );
}

describe('ViajePropioNuevoRoute', () => {
  beforeEach(() => {
    providedContext = { kind: 'unmanaged' };
  });

  it('sin capacidad asignar → mensaje de permiso', () => {
    providedContext = {
      kind: 'onboarded',
      me: makeMe({ role: 'conductor', transportista: true }),
    };
    renderRoute();
    expect(screen.getByText(/no puede dar de alta viajes propios/i)).toBeInTheDocument();
  });

  it('despachador transportista → muestra el formulario', () => {
    providedContext = { kind: 'onboarded', me: makeMe() };
    renderRoute();
    expect(screen.getByRole('heading', { name: 'Nuevo viaje propio' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Crear viaje propio' })).toBeInTheDocument();
  });
});

describe('formToBody — correo del cliente externo (.specs/frente2-cierre D2)', () => {
  it('lleva el correo al cuerpo cuando se escribe, y no lo manda vacío', async () => {
    const { formToBody, VALORES_INICIALES } = await import('./viaje-propio-nuevo.js');
    const base = {
      ...VALORES_INICIALES,
      origin_address_raw: 'Av. Apoquindo 3000',
      origin_region_code: 'XIII' as const,
      destination_address_raw: 'Puerto San Antonio',
      destination_region_code: 'V' as const,
      cliente_tipo: 'externo' as const,
      externo_nombre: 'Viña Santa Clara SpA',
    };
    expect(formToBody({ ...base, externo_correo: ' compras@vina.cl ' }).cliente).toMatchObject({
      tipo: 'externo',
      correo: 'compras@vina.cl',
    });
    expect(formToBody({ ...base, externo_correo: '' }).cliente).not.toHaveProperty('correo');
  });
});
