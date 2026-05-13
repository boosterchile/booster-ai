import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  Outlet: () => <div data-testid="outlet">outlet</div>,
  useNavigate: () => () => undefined,
}));

// DemoBanner se monta global pero se self-gatea con useIsDemo(). En el
// test del root no inyectamos provider de Firebase auth ni QueryClient,
// así que mockeamos useIsDemo para devolver false (path "no banner").
vi.mock('../hooks/use-is-demo.js', () => ({
  useIsDemo: () => false,
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
});
