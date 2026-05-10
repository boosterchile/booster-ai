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

const descargarMock = vi.fn();
vi.mock('../lib/cert-download.js', () => ({
  descargarCertificadoDeViaje: descargarMock,
  CertDisabledError: class CertDisabledError extends Error {},
  CertNotIssuedError: class CertNotIssuedError extends Error {},
}));

const { CertificadosRoute } = await import('./certificados.js');

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
      <CertificadosRoute />
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

describe('CertificadosRoute', () => {
  it('no onboarded → no renderiza Layout', () => {
    const { container } = renderRoute();
    expect(container.querySelector('[data-testid="layout"]')).toBeNull();
  });

  it('onboarded pero no shipper → mensaje "para empresas que operan como generador"', () => {
    providedContext = { kind: 'onboarded', me: makeMe(false) };
    renderRoute();
    expect(screen.getByText(/empresas que operan como generador/)).toBeInTheDocument();
  });

  it('shipper + sin certificados → EmptyState', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      certificates: [],
      pagination: { limit: 100, offset: 0, returned: 0 },
    });
    providedContext = { kind: 'onboarded', me: makeMe(true) };
    renderRoute();
    await waitFor(() => expect(screen.getByTestId('empty-state')).toBeInTheDocument());
  });

  it('shipper + certificados → renderiza tracking codes', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      certificates: [
        {
          trip_id: 't1',
          tracking_code: 'BST-001',
          origin_address: 'A',
          destination_address: 'B',
          cargo_type: 'carga_seca',
          kg_co2e: '50.00',
          distance_km: '100.00',
          precision_method: 'modelado',
          glec_version: 'GLEC v3.0',
          certificate_sha256: 'abc',
          certificate_kms_key_version: '1',
          certificate_issued_at: '2026-05-10T10:00:00Z',
        },
      ],
      pagination: { limit: 100, offset: 0, returned: 1 },
    });
    providedContext = { kind: 'onboarded', me: makeMe(true) };
    renderRoute();
    await waitFor(() => expect(screen.getByText('BST-001')).toBeInTheDocument());
  });

  it('click Descargar → invoca descargarCertificadoDeViaje', async () => {
    descargarMock.mockResolvedValueOnce(undefined);
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      certificates: [
        {
          trip_id: 't1',
          tracking_code: 'BST-001',
          origin_address: 'A',
          destination_address: 'B',
          cargo_type: 'carga_seca',
          kg_co2e: '50.00',
          distance_km: '100.00',
          precision_method: 'modelado',
          glec_version: 'GLEC v3.0',
          certificate_sha256: 'abc',
          certificate_kms_key_version: '1',
          certificate_issued_at: '2026-05-10T10:00:00Z',
        },
      ],
      pagination: { limit: 100, offset: 0, returned: 1 },
    });
    providedContext = { kind: 'onboarded', me: makeMe(true) };
    renderRoute();
    const btn = await screen.findByRole('button', { name: /Descargar/ });
    fireEvent.click(btn);
    await waitFor(() => expect(descargarMock).toHaveBeenCalled());
  });
});
