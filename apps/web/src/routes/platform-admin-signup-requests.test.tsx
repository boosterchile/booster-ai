import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api-client.js';

/**
 * Tests del route `/app/platform-admin/signup-requests` — W1.4 (hito-2-corfo-mes-8,
 * desviación 8): cierra el eslabón faltante del alta gateada por admin. Mientras el
 * email real (Fase 2) no exista, el admin es el único canal de entrega del token de
 * onboarding — este test cubre que el link aparece copiable tras un approve exitoso,
 * que sobrevive el refetch de la lista (que ya no incluye la solicitud aprobada,
 * porque GET solo devuelve pendientes), y el fallback de clipboard.
 *
 * Patrón de mocks (consistente con platform-admin-observability.test.tsx):
 *   - `ProtectedRoute` bypass (meRequirement="skip" → children(unmanaged)).
 *   - `Link` de tanstack-router → `<a>`.
 *   - `api.get`/`api.post` espiados directamente sobre el objeto `api` (no
 *     requiere `vi.mock('../lib/api-client.js')`, igual que observability).
 */

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

const { PlatformAdminSignupRequestsRoute } = await import('./platform-admin-signup-requests.js');

const PENDING_REQUEST = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'nuevo@cliente.cl',
  nombre_completo: 'Nuevo Cliente',
  estado: 'pendiente_aprobacion' as const,
  solicitado_en: '2026-07-01T10:00:00Z',
};

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PlatformAdminSignupRequestsRoute — W1.4 onboarding_link', () => {
  it('approve con onboarding_link en la respuesta → muestra el panel copiable + aviso', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ signup_requests: [PENDING_REQUEST] });
    vi.spyOn(api, 'post').mockResolvedValue({
      ok: true,
      outcome: 'approved',
      firebase_uid: 'fb-uid',
      user_id: null,
      onboarding_link: 'https://app.boosterchile.com/onboarding-admin?token=abc.def',
      onboarding_link_expires_at: '2026-07-08T10:00:00Z',
    });
    stubClipboard(vi.fn(async () => undefined));

    render(<PlatformAdminSignupRequestsRoute />);
    await waitFor(() => screen.getByText(PENDING_REQUEST.email));

    fireEvent.click(screen.getByRole('button', { name: /Aprobar/ }));

    await waitFor(() =>
      expect(
        screen.getByText(/Copia y envía este enlace ahora — por seguridad no se volverá a mostrar/),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByText('https://app.boosterchile.com/onboarding-admin?token=abc.def'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Copiar enlace/ })).toBeInTheDocument();
  });

  it('click en "Copiar enlace" llama a clipboard.writeText y da feedback de copiado', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ signup_requests: [PENDING_REQUEST] });
    vi.spyOn(api, 'post').mockResolvedValue({
      ok: true,
      outcome: 'approved',
      firebase_uid: 'fb-uid',
      user_id: null,
      onboarding_link: 'https://app.boosterchile.com/onboarding-admin?token=abc.def',
      onboarding_link_expires_at: '2026-07-08T10:00:00Z',
    });
    const writeText = vi.fn(async () => undefined);
    stubClipboard(writeText);

    render(<PlatformAdminSignupRequestsRoute />);
    await waitFor(() => screen.getByText(PENDING_REQUEST.email));
    fireEvent.click(screen.getByRole('button', { name: /Aprobar/ }));
    await waitFor(() => screen.getByRole('button', { name: /Copiar enlace/ }));

    fireEvent.click(screen.getByRole('button', { name: /Copiar enlace/ }));

    expect(writeText).toHaveBeenCalledWith(
      'https://app.boosterchile.com/onboarding-admin?token=abc.def',
    );
    await waitFor(() => expect(screen.getByText(/Copiado/)).toBeInTheDocument());
  });

  it('el feedback "Copiado ✓" vuelve a "Copiar enlace" después de 2.5s', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ signup_requests: [PENDING_REQUEST] });
    vi.spyOn(api, 'post').mockResolvedValue({
      ok: true,
      outcome: 'approved',
      firebase_uid: 'fb-uid',
      user_id: null,
      onboarding_link: 'https://app.boosterchile.com/onboarding-admin?token=abc.def',
      onboarding_link_expires_at: '2026-07-08T10:00:00Z',
    });
    stubClipboard(vi.fn(async () => undefined));

    render(<PlatformAdminSignupRequestsRoute />);
    await waitFor(() => screen.getByText(PENDING_REQUEST.email));
    fireEvent.click(screen.getByRole('button', { name: /Aprobar/ }));
    await waitFor(() => screen.getByRole('button', { name: /Copiar enlace/ }));

    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      fireEvent.click(screen.getByRole('button', { name: /Copiar enlace/ }));
      await vi.waitFor(() => expect(screen.getByText(/Copiado/)).toBeInTheDocument());
      vi.advanceTimersByTime(2500);
      await vi.waitFor(() =>
        expect(screen.getByRole('button', { name: /^Copiar enlace$/ })).toBeInTheDocument(),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('botón "Ocultar" quita el panel del link de onboarding', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ signup_requests: [PENDING_REQUEST] });
    vi.spyOn(api, 'post').mockResolvedValue({
      ok: true,
      outcome: 'approved',
      firebase_uid: 'fb-uid',
      user_id: null,
      onboarding_link: 'https://app.boosterchile.com/onboarding-admin?token=abc.def',
      onboarding_link_expires_at: '2026-07-08T10:00:00Z',
    });
    stubClipboard(vi.fn(async () => undefined));

    render(<PlatformAdminSignupRequestsRoute />);
    await waitFor(() => screen.getByText(PENDING_REQUEST.email));
    fireEvent.click(screen.getByRole('button', { name: /Aprobar/ }));
    await waitFor(() => screen.getByRole('button', { name: 'Ocultar' }));

    fireEvent.click(screen.getByRole('button', { name: 'Ocultar' }));

    expect(
      screen.queryByText('https://app.boosterchile.com/onboarding-admin?token=abc.def'),
    ).not.toBeInTheDocument();
  });

  it('si clipboard.writeText falla, muestra un input readonly seleccionable con el link', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ signup_requests: [PENDING_REQUEST] });
    vi.spyOn(api, 'post').mockResolvedValue({
      ok: true,
      outcome: 'approved',
      firebase_uid: 'fb-uid',
      user_id: null,
      onboarding_link: 'https://app.boosterchile.com/onboarding-admin?token=abc.def',
      onboarding_link_expires_at: '2026-07-08T10:00:00Z',
    });
    stubClipboard(
      vi.fn(async () => {
        throw new Error('clipboard denied');
      }),
    );

    render(<PlatformAdminSignupRequestsRoute />);
    await waitFor(() => screen.getByText(PENDING_REQUEST.email));
    fireEvent.click(screen.getByRole('button', { name: /Aprobar/ }));
    await waitFor(() => screen.getByRole('button', { name: /Copiar enlace/ }));

    fireEvent.click(screen.getByRole('button', { name: /Copiar enlace/ }));

    const selectSpy = vi.spyOn(HTMLInputElement.prototype, 'select');
    await waitFor(() => {
      const input = screen.getByDisplayValue(
        'https://app.boosterchile.com/onboarding-admin?token=abc.def',
      ) as HTMLInputElement;
      expect(input).toHaveAttribute('readonly');
      fireEvent.focus(input);
      expect(selectSpy).toHaveBeenCalled();
    });
  });

  it('approve SIN onboarding_link en la respuesta (flag OFF) → sin panel nuevo', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ signup_requests: [PENDING_REQUEST] });
    vi.spyOn(api, 'post').mockResolvedValue({
      ok: true,
      outcome: 'approved',
      firebase_uid: 'fb-uid',
      user_id: 'user-uuid',
    });

    render(<PlatformAdminSignupRequestsRoute />);
    await waitFor(() => screen.getByText(PENDING_REQUEST.email));
    fireEvent.click(screen.getByRole('button', { name: /Aprobar/ }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Copiar enlace/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/no se volverá a mostrar/)).not.toBeInTheDocument();
  });

  it('el link sigue visible tras el refetch de la lista (que ya no incluye la solicitud aprobada)', async () => {
    const getSpy = vi
      .spyOn(api, 'get')
      // Primer fetch (mount): la solicitud pendiente.
      .mockResolvedValueOnce({ signup_requests: [PENDING_REQUEST] })
      // Refetch post-approve: la lista de pendientes ya no la incluye.
      .mockResolvedValueOnce({ signup_requests: [] });
    vi.spyOn(api, 'post').mockResolvedValue({
      ok: true,
      outcome: 'approved',
      firebase_uid: 'fb-uid',
      user_id: null,
      onboarding_link: 'https://app.boosterchile.com/onboarding-admin?token=abc.def',
      onboarding_link_expires_at: '2026-07-08T10:00:00Z',
    });
    stubClipboard(vi.fn(async () => undefined));

    render(<PlatformAdminSignupRequestsRoute />);
    await waitFor(() => screen.getByText(PENDING_REQUEST.email));
    fireEvent.click(screen.getByRole('button', { name: /Aprobar/ }));

    await waitFor(() => expect(getSpy).toHaveBeenCalledTimes(2));
    // La solicitud ya no está en la lista de pendientes...
    expect(screen.getByText(/Sin solicitudes pendientes/)).toBeInTheDocument();
    // ...pero el link copiable sigue visible (estado separado, keyed por id).
    expect(
      screen.getByText('https://app.boosterchile.com/onboarding-admin?token=abc.def'),
    ).toBeInTheDocument();
  });
});
