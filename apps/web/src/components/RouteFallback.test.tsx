import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RouteFallback } from './RouteFallback.js';

describe('RouteFallback', () => {
  it('renderiza el estado de carga anunciable (role=status)', () => {
    render(<RouteFallback />);
    const status = screen.getByRole('status');
    expect(status).toBeInTheDocument();
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent('Cargando');
  });
});
