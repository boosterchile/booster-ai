import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api-client.js';
import { ConsentTermsBanner } from './ConsentTermsBanner.js';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
}));

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function renderBanner() {
  const Wrapper = makeWrapper();
  return render(
    <Wrapper>
      <ConsentTermsBanner />
    </Wrapper>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('ConsentTermsBanner', () => {
  it('isLoading → null (sin flash)', () => {
    vi.spyOn(api, 'get').mockImplementation(() => new Promise<never>(() => undefined));
    const { container } = renderBanner();
    expect(container.firstChild).toBeNull();
  });

  it('accepted=true → null', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      accepted: true,
      accepted_at: '2026-05-10T12:00:00Z',
    });
    const { container } = renderBanner();
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it('reason=not_a_carrier → null (no aplica a shippers)', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      accepted: true,
      reason: 'not_a_carrier',
    });
    const { container } = renderBanner();
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it('reason=no_active_empresa → null', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      accepted: false,
      reason: 'no_active_empresa',
    });
    const { container } = renderBanner();
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it('accepted=false reason=pending → muestra banner con link a /legal/terminos', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      accepted: false,
      reason: 'pending',
    });
    renderBanner();
    expect(
      await screen.findByText(/Necesitamos tu aceptación de Términos de Servicio v2/),
    ).toBeInTheDocument();
    const link = screen.getByText(/Revisar y aceptar/).closest('a');
    expect(link).toHaveAttribute('to', '/legal/terminos');
  });
});
