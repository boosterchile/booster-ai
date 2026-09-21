import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeResponse } from '../hooks/use-me.js';
import { api } from '../lib/api-client.js';

type MeOnboarded = Extract<MeResponse, { needs_onboarding: false }>;

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

const { ZonasRoute } = await import('./zonas.js');

function makeMe(over: { role?: string; transportista?: boolean } = {}): MeOnboarded {
  return {
    needs_onboarding: false,
    user: { id: 'u1', email: 'jefe@x.cl', full_name: 'Jefa', rut: '11111111-1' },
    memberships: [],
    active_membership: {
      role: over.role ?? 'dueno',
      empresa: {
        id: 'e1',
        legal_name: 'Transportes X',
        is_transportista: over.transportista ?? true,
        is_generador_carga: false,
      },
    },
  } as unknown as MeOnboarded;
}

const ZONA = {
  id: 'z-1',
  empresa_id: 'e1',
  region_code: 'XIII',
  comuna_codes: null,
  zone_type: 'ambos' as const,
  is_active: true,
  created_at: '2026-09-21T12:00:00.000Z',
  updated_at: '2026-09-21T12:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  providedContext = { kind: 'onboarded', me: makeMe() };
});

describe('/app/zonas', () => {
  it('lista regiones y permite agregar XIII / ambos', async () => {
    const getSpy = vi.spyOn(api, 'get').mockResolvedValue({ zonas: [] });
    const postSpy = vi.spyOn(api, 'post').mockResolvedValue({ zona: ZONA });

    render(<ZonasRoute />);

    expect(await screen.findByTestId('zona-empty')).toBeInTheDocument();
    expect(getSpy).toHaveBeenCalledWith('/me/zonas');

    fireEvent.change(screen.getByTestId('zona-region'), { target: { value: 'XIII' } });
    fireEvent.change(screen.getByTestId('zona-tipo'), { target: { value: 'ambos' } });
    fireEvent.click(screen.getByTestId('zona-agregar'));

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith('/me/zonas', {
        region_code: 'XIII',
        zone_type: 'ambos',
      });
    });
  });

  it('toggle activa llama PATCH is_active', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ zonas: [ZONA] });
    const patchSpy = vi.spyOn(api, 'patch').mockResolvedValue({
      zona: { ...ZONA, is_active: false },
    });

    render(<ZonasRoute />);
    expect(await screen.findByText(/XIII — Metropolitana/)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('zona-toggle-z-1'));
    await waitFor(() => {
      expect(patchSpy).toHaveBeenCalledWith('/me/zonas/z-1', { is_active: false });
    });
  });

  it('despachador no gestiona zonas', async () => {
    providedContext = { kind: 'onboarded', me: makeMe({ role: 'despachador' }) };
    const getSpy = vi.spyOn(api, 'get');
    render(<ZonasRoute />);
    expect(await screen.findByText(/Solo el dueño o un administrador/i)).toBeInTheDocument();
    expect(getSpy).not.toHaveBeenCalled();
  });
});
