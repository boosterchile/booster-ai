import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

/**
 * Tests del ImpersonationPicker (platform-admin). Lista usuarios de empresas
 * es_demo (GET /auth/impersonate/targets) con "Ver como" por fila → POST
 * /auth/impersonate → signInUniversalWithCustomToken. Maneja el 503 (flag OFF)
 * con gracia. En D2.
 */

const getMock = vi.fn();
const postMock = vi.fn();
const signInMock = vi.fn().mockResolvedValue({ uid: 'target' });

vi.mock('../lib/api-client.js', async (orig) => {
  const actual = await orig<typeof import('../lib/api-client.js')>();
  return {
    ...actual,
    api: { get: (p: string) => getMock(p), post: (p: string, b: unknown) => postMock(p, b) },
  };
});
vi.mock('../hooks/use-auth.js', () => ({
  signInUniversalWithCustomToken: (t: string) => signInMock(t),
}));

const { ImpersonationPicker, ImpersonationPickerView } = await import('./ImpersonationPicker.js');

function wrap(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const TARGETS = [
  { id: 'u1', full_name: 'Ana Demo', empresa: 'Demo Shipper SpA', role: 'dueno' },
  { id: 'u2', full_name: 'Beto Demo', empresa: 'Demo Carrier SpA', role: 'despachador' },
];

afterEach(() => vi.clearAllMocks());

describe('ImpersonationPickerView (presentacional)', () => {
  it('state=disabled → muestra que impersonación está desactivada (no error crudo)', () => {
    render(
      <ImpersonationPickerView
        state="disabled"
        targets={[]}
        impersonatingId={null}
        onImpersonate={() => undefined}
      />,
    );
    expect(screen.getByText(/desactivada/i)).toBeInTheDocument();
  });

  it('state=loading → Cargando', () => {
    render(
      <ImpersonationPickerView
        state="loading"
        targets={[]}
        impersonatingId={null}
        onImpersonate={() => undefined}
      />,
    );
    expect(screen.getByText(/Cargando/i)).toBeInTheDocument();
  });

  it('state=error → mensaje de error', () => {
    render(
      <ImpersonationPickerView
        state="error"
        targets={[]}
        impersonatingId={null}
        onImpersonate={() => undefined}
      />,
    );
    expect(screen.getByText(/No pudimos/i)).toBeInTheDocument();
  });

  it('state=ready + targets → lista con nombre/empresa/rol + "Ver como" por fila', () => {
    const onImpersonate = vi.fn();
    render(
      <ImpersonationPickerView
        state="ready"
        targets={TARGETS}
        impersonatingId={null}
        onImpersonate={onImpersonate}
      />,
    );
    expect(screen.getByText('Ana Demo')).toBeInTheDocument();
    expect(screen.getByText(/Demo Shipper SpA/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Ver como/i })).toHaveLength(2);
  });

  it('state=ready sin targets → mensaje de lista vacía', () => {
    render(
      <ImpersonationPickerView
        state="ready"
        targets={[]}
        impersonatingId={null}
        onImpersonate={() => undefined}
      />,
    );
    expect(screen.getByText(/No hay usuarios/i)).toBeInTheDocument();
  });

  it('click "Ver como" → onImpersonate(id)', async () => {
    const onImpersonate = vi.fn();
    render(
      <ImpersonationPickerView
        state="ready"
        targets={TARGETS}
        impersonatingId={null}
        onImpersonate={onImpersonate}
      />,
    );
    const first = screen.getAllByRole('button', { name: /Ver como/i })[0];
    if (!first) {
      throw new Error('sin botón');
    }
    await userEvent.click(first);
    expect(onImpersonate).toHaveBeenCalledWith('u1');
  });

  it('sin violaciones de a11y (vitest-axe)', async () => {
    // El picker vive dentro del <main> de platform-admin; lo envolvemos en un
    // landmark para que la regla `region` refleje el uso real.
    const { baseElement } = render(
      <main>
        <ImpersonationPickerView
          state="ready"
          targets={TARGETS}
          impersonatingId={null}
          onImpersonate={() => undefined}
        />
      </main>,
    );
    const results = await axe(baseElement, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
});

describe('ImpersonationPicker (container)', () => {
  it('carga y lista los targets del backend', async () => {
    getMock.mockResolvedValue({ targets: TARGETS });
    wrap(<ImpersonationPicker />);
    await waitFor(() => expect(screen.getByText('Ana Demo')).toBeInTheDocument());
    expect(getMock).toHaveBeenCalledWith('/auth/impersonate/targets');
  });

  it('"Ver como" → POST /auth/impersonate + signInUniversalWithCustomToken', async () => {
    getMock.mockResolvedValue({ targets: TARGETS });
    postMock.mockResolvedValue({ custom_token: 'tok-123' });
    wrap(<ImpersonationPicker />);
    await waitFor(() => expect(screen.getByText('Ana Demo')).toBeInTheDocument());
    const first = screen.getAllByRole('button', { name: /Ver como/i })[0];
    if (!first) {
      throw new Error('sin botón');
    }
    await userEvent.click(first);
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/auth/impersonate', { target_user_id: 'u1' }),
    );
    await waitFor(() => expect(signInMock).toHaveBeenCalledWith('tok-123'));
  });

  it('backend 503 (flag OFF) → estado desactivado, no error crudo', async () => {
    const { ApiError } = await import('../lib/api-client.js');
    getMock.mockRejectedValue(new ApiError(503, 'feature_disabled', null));
    wrap(<ImpersonationPicker />);
    await waitFor(() => expect(screen.getByText(/desactivada/i)).toBeInTheDocument());
  });
});
