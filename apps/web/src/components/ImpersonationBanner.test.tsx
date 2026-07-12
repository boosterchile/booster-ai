import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { RotarClaveModal } from './auth/RotarClaveModal.js';

/**
 * Tests del ImpersonationBanner (impersonación auditada, frontend). Banner fijo
 * arriba, imposible de ignorar, con botón Salir → login. Reusa el patrón de
 * DemoBanner. En D2 (primitivas + tokens, sin hardcode).
 */

const navigateMock = vi.fn();
const signOutMock = vi.fn().mockResolvedValue(undefined);
const useImpersonationMock = vi.fn();
const useMeMock = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
}));
vi.mock('../hooks/use-impersonation.js', () => ({
  useImpersonation: () => useImpersonationMock(),
}));
vi.mock('../hooks/use-auth.js', () => ({
  signOutUser: () => signOutMock(),
}));
vi.mock('../hooks/use-me.js', () => ({
  useMe: () => useMeMock(),
}));

const { ImpersonationBanner, ImpersonationBannerView } = await import('./ImpersonationBanner.js');

describe('ImpersonationBannerView (presentacional)', () => {
  it('muestra el nombre del target + empresa + botón Salir', () => {
    render(
      <ImpersonationBannerView
        targetName="Ana Demo"
        empresa="Demo Shipper SpA"
        onExit={() => undefined}
      />,
    );
    expect(screen.getByTestId('impersonation-banner')).toBeInTheDocument();
    expect(screen.getByText(/Ana Demo/)).toBeInTheDocument();
    expect(screen.getByText(/Demo Shipper SpA/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Salir/i })).toBeInTheDocument();
  });

  it('es un role=alert (imposible de ignorar por lectores de pantalla)', () => {
    render(<ImpersonationBannerView targetName="Ana" empresa={null} onExit={() => undefined} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('sin violaciones de a11y (vitest-axe)', async () => {
    const { baseElement } = render(
      <ImpersonationBannerView targetName="Ana Demo" empresa="Demo SpA" onExit={() => undefined} />,
    );
    const results = await axe(baseElement, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations).toEqual([]);
  });

  it('click Salir → onExit', async () => {
    const onExit = vi.fn();
    render(<ImpersonationBannerView targetName="Ana" empresa={null} onExit={onExit} />);
    await userEvent.click(screen.getByRole('button', { name: /Salir/i }));
    expect(onExit).toHaveBeenCalled();
  });
});

describe('ImpersonationBanner (container)', () => {
  it('no renderiza nada si active !== true', () => {
    useImpersonationMock.mockReturnValue({ active: false, impersonatedBy: null });
    useMeMock.mockReturnValue({ data: undefined });
    const { container } = render(<ImpersonationBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('no renderiza nada mientras active === null (loading)', () => {
    useImpersonationMock.mockReturnValue({ active: null, impersonatedBy: null });
    useMeMock.mockReturnValue({ data: undefined });
    const { container } = render(<ImpersonationBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('active → renderiza el banner con el nombre del target (de useMe)', () => {
    useImpersonationMock.mockReturnValue({ active: true, impersonatedBy: 'admin' });
    useMeMock.mockReturnValue({
      data: {
        needs_onboarding: false,
        user: { full_name: 'Ana Demo' },
        active_membership: { empresa: { legal_name: 'Demo Shipper SpA' } },
      },
    });
    render(<ImpersonationBanner />);
    expect(screen.getByTestId('impersonation-banner')).toBeInTheDocument();
    expect(screen.getByText(/Ana Demo/)).toBeInTheDocument();
    expect(screen.getByText(/Demo Shipper SpA/)).toBeInTheDocument();
  });

  it('botón Salir → signOutUser + navega a /login', async () => {
    useImpersonationMock.mockReturnValue({ active: true, impersonatedBy: 'admin' });
    useMeMock.mockReturnValue({
      data: {
        needs_onboarding: false,
        user: { full_name: 'Ana Demo' },
        active_membership: null,
      },
    });
    render(<ImpersonationBanner />);
    await userEvent.click(screen.getByRole('button', { name: /Salir/i }));
    expect(signOutMock).toHaveBeenCalled();
    await vi.waitFor(() => expect(navigateMock).toHaveBeenCalledWith({ to: '/login' }));
  });
});

/** Extrae el z-index numérico de la className (soporta `z-50` y `z-[60]`). */
function zIndexOf(el: HTMLElement): number {
  const cls = el.className;
  const bracket = cls.match(/z-\[(\d+)\]/);
  if (bracket) {
    return Number(bracket[1]);
  }
  const plain = cls.match(/\bz-(\d+)\b/);
  if (plain) {
    return Number(plain[1]);
  }
  throw new Error(`sin clase z-index en className: "${cls}"`);
}

describe('z-ordering: el banner escapa por encima de los overlays (Salir siempre alcanzable)', () => {
  it('el banner de impersonación stackea por encima del modal de clave (C4)', () => {
    // C4 (rojo antes del fix): banner y modal comparten z-50, así que el modal
    // (montado después en el DOM) gana el tie y tapa "Salir", atrapando al
    // admin sin escape. El banner debe stackear ESTRICTAMENTE por encima.
    const banner = render(
      <ImpersonationBannerView targetName="Ana" empresa={null} onExit={() => undefined} />,
    );
    const bannerZ = zIndexOf(banner.getByTestId('impersonation-banner'));
    banner.unmount();

    const client = new QueryClient();
    const modal = render(
      <QueryClientProvider client={client}>
        <RotarClaveModal />
      </QueryClientProvider>,
    );
    const modalZ = zIndexOf(modal.getByTestId('rotar-clave-modal'));

    expect(bannerZ).toBeGreaterThan(modalZ);
  });
});
