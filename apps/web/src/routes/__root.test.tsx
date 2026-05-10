import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  Outlet: () => <div data-testid="outlet">outlet</div>,
}));

const { RootComponent } = await import('./__root.js');

describe('RootComponent', () => {
  it('renderiza <Outlet />', () => {
    render(<RootComponent />);
    expect(screen.getByTestId('outlet')).toBeInTheDocument();
  });
});
