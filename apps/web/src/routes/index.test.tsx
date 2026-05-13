import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const useAuthMock = vi.fn();
vi.mock('../hooks/use-auth.js', () => ({
  useAuth: useAuthMock,
}));

vi.mock('@tanstack/react-router', () => ({
  Navigate: ({ to }: { to: string }) => <div data-testid="navigate" data-to={to} />,
}));

const { IndexRoute } = await import('./index.js');

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('IndexRoute', () => {
  it('loading=true → muestra splash "Cargando…"', () => {
    useAuthMock.mockReturnValue({ user: null, loading: true });
    render(<IndexRoute />);
    expect(screen.getByText(/Cargando…/)).toBeInTheDocument();
  });

  it('loading=false + user null → redirect /login', () => {
    useAuthMock.mockReturnValue({ user: null, loading: false });
    render(<IndexRoute />);
    expect(screen.getByTestId('navigate')).toHaveAttribute('data-to', '/login');
  });

  it('loading=false + user presente → redirect /app', () => {
    useAuthMock.mockReturnValue({ user: { uid: 'u' }, loading: false });
    render(<IndexRoute />);
    expect(screen.getByTestId('navigate')).toHaveAttribute('data-to', '/app');
  });

  it('host demo.boosterchile.com + user null → redirect /demo', () => {
    useAuthMock.mockReturnValue({ user: null, loading: false });
    vi.stubGlobal('location', { hostname: 'demo.boosterchile.com' });
    render(<IndexRoute />);
    expect(screen.getByTestId('navigate')).toHaveAttribute('data-to', '/demo');
    vi.unstubAllGlobals();
  });

  it('host demo.boosterchile.com + user presente → redirect /app (banner se muestra global)', () => {
    useAuthMock.mockReturnValue({ user: { uid: 'u' }, loading: false });
    vi.stubGlobal('location', { hostname: 'demo.boosterchile.com' });
    render(<IndexRoute />);
    expect(screen.getByTestId('navigate')).toHaveAttribute('data-to', '/app');
    vi.unstubAllGlobals();
  });
});
