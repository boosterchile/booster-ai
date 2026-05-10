import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PushDisabledError,
  PushPermissionDeniedError,
  isWebPushSupported,
  subscribeToWebPush,
} from '../../lib/web-push.js';
import { PushSubscribeBanner } from './PushSubscribeBanner.js';

vi.mock('../../lib/web-push.js', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/web-push.js')>('../../lib/web-push.js');
  return {
    ...actual,
    isWebPushSupported: vi.fn(),
    subscribeToWebPush: vi.fn(),
  };
});

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

function renderBanner() {
  const Wrapper = makeWrapper();
  return render(
    <Wrapper>
      <PushSubscribeBanner />
    </Wrapper>,
  );
}

beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
  // Default: support + permission default.
  vi.mocked(isWebPushSupported).mockReturnValue(true);
  (globalThis as any).Notification = { permission: 'default' };
});

afterEach(() => {
  Reflect.deleteProperty(globalThis as any, 'Notification');
  vi.restoreAllMocks();
});

describe('PushSubscribeBanner — visibilidad', () => {
  it('no soporta Web Push → no se renderiza', () => {
    vi.mocked(isWebPushSupported).mockReturnValue(false);
    const { container } = renderBanner();
    expect(container.firstChild).toBeNull();
  });

  it('permission=granted → no se renderiza', () => {
    (globalThis as any).Notification = { permission: 'granted' };
    const { container } = renderBanner();
    expect(container.firstChild).toBeNull();
  });

  it('permission=denied → no se renderiza', () => {
    (globalThis as any).Notification = { permission: 'denied' };
    const { container } = renderBanner();
    expect(container.firstChild).toBeNull();
  });

  it('dismissed flag en sessionStorage → no se renderiza', () => {
    sessionStorage.setItem('booster.pushBanner.dismissed', '1');
    const { container } = renderBanner();
    expect(container.firstChild).toBeNull();
  });

  it('soporte + permission default + sin flag → se muestra', () => {
    renderBanner();
    expect(screen.getByText(/Activa las notificaciones/)).toBeInTheDocument();
  });
});

describe('PushSubscribeBanner — acciones', () => {
  it('click Activar → subscribeToWebPush + se oculta on success', async () => {
    vi.mocked(subscribeToWebPush).mockResolvedValueOnce({
      endpoint: 'https://x',
    } as never);
    const { container } = renderBanner();
    fireEvent.click(screen.getByRole('button', { name: 'Activar' }));
    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
    expect(subscribeToWebPush).toHaveBeenCalled();
  });

  it('PushPermissionDeniedError → set dismiss flag + ocultar', async () => {
    vi.mocked(subscribeToWebPush).mockRejectedValueOnce(new PushPermissionDeniedError());
    const { container } = renderBanner();
    fireEvent.click(screen.getByRole('button', { name: 'Activar' }));
    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
    expect(sessionStorage.getItem('booster.pushBanner.dismissed')).toBe('1');
  });

  it('PushDisabledError → set dismiss flag + ocultar', async () => {
    vi.mocked(subscribeToWebPush).mockRejectedValueOnce(new PushDisabledError());
    const { container } = renderBanner();
    fireEvent.click(screen.getByRole('button', { name: 'Activar' }));
    await waitFor(() => {
      expect(container.firstChild).toBeNull();
    });
    expect(sessionStorage.getItem('booster.pushBanner.dismissed')).toBe('1');
  });

  it('error genérico → log warn + sigue visible', async () => {
    vi.mocked(subscribeToWebPush).mockRejectedValueOnce(new Error('network'));
    renderBanner();
    fireEvent.click(screen.getByRole('button', { name: 'Activar' }));
    await waitFor(() => {
      // Sigue visible.
      expect(screen.getByText(/Activa las notificaciones/)).toBeInTheDocument();
    });
    // No flag de dismiss.
    expect(sessionStorage.getItem('booster.pushBanner.dismissed')).toBeNull();
  });

  it('click X (Descartar) → flag + ocultar', () => {
    const { container } = renderBanner();
    fireEvent.click(screen.getByRole('button', { name: 'Descartar banner' }));
    expect(container.firstChild).toBeNull();
    expect(sessionStorage.getItem('booster.pushBanner.dismissed')).toBe('1');
  });

  it('mientras isPending → botón muestra "Activando…" y disabled', async () => {
    vi.mocked(subscribeToWebPush).mockImplementation(() => new Promise<never>(() => undefined));
    renderBanner();
    fireEvent.click(screen.getByRole('button', { name: 'Activar' }));
    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /Activando/ });
      expect(btn).toBeDisabled();
    });
  });
});
