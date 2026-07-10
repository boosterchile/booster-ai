import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  Outlet: () => <div data-testid="outlet">outlet</div>,
  useNavigate: () => () => undefined,
}));

// DemoBanner e ImpersonationBanner se montan global pero se self-gatean
// (useIsDemo() / useImpersonation()). En el test del root no inyectamos
// provider de Firebase auth ni QueryClient, así que mockeamos ambos hooks
// al path "no banner".
vi.mock('../hooks/use-is-demo.js', () => ({
  useIsDemo: () => false,
}));
vi.mock('../hooks/use-impersonation.js', () => ({
  useImpersonation: () => ({ active: false, impersonatedBy: null }),
}));
// ImpersonationBanner llama useMe() incondicionalmente (regla de hooks); sin
// QueryClient real en este test, lo mockeamos.
vi.mock('../hooks/use-me.js', () => ({
  useMe: () => ({ data: undefined }),
}));

const { RootComponent } = await import('./__root.js');

describe('RootComponent', () => {
  it('renderiza <Outlet />', () => {
    render(<RootComponent />);
    expect(screen.getByTestId('outlet')).toBeInTheDocument();
  });

  it('no muestra DemoBanner cuando useIsDemo() = false', () => {
    render(<RootComponent />);
    expect(screen.queryByTestId('demo-banner')).not.toBeInTheDocument();
  });

  it('no muestra ImpersonationBanner cuando la sesión no es impersonada', () => {
    render(<RootComponent />);
    expect(screen.queryByTestId('impersonation-banner')).not.toBeInTheDocument();
  });
});
