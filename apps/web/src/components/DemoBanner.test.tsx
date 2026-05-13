import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const navigateMock = vi.fn();
const signOutMock = vi.fn().mockResolvedValue(undefined);
const useIsDemoMock = vi.fn<() => boolean | null>();

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
}));

vi.mock('../hooks/use-is-demo.js', () => ({
  useIsDemo: () => useIsDemoMock(),
}));

vi.mock('../hooks/use-auth.js', () => ({
  signOutUser: () => signOutMock(),
}));

const { DemoBanner } = await import('./DemoBanner.js');

describe('DemoBanner', () => {
  it('renderiza el banner cuando useIsDemo() = true', () => {
    useIsDemoMock.mockReturnValue(true);
    render(<DemoBanner />);
    expect(screen.getByTestId('demo-banner')).toBeInTheDocument();
    expect(screen.getByText(/MODO DEMO/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Salir del demo/i })).toBeInTheDocument();
  });

  it('no renderiza nada cuando useIsDemo() = false', () => {
    useIsDemoMock.mockReturnValue(false);
    const { container } = render(<DemoBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('no renderiza nada cuando useIsDemo() = null (loading)', () => {
    useIsDemoMock.mockReturnValue(null);
    const { container } = render(<DemoBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('botón Salir llama signOutUser y navega a /demo', async () => {
    useIsDemoMock.mockReturnValue(true);
    navigateMock.mockClear();
    signOutMock.mockClear();
    const user = userEvent.setup();
    render(<DemoBanner />);
    await user.click(screen.getByRole('button', { name: /Salir del demo/i }));
    expect(signOutMock).toHaveBeenCalledOnce();
    expect(navigateMock).toHaveBeenCalledWith({ to: '/demo' });
  });
});
