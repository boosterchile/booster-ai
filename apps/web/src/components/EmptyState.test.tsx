import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EmptyState } from './EmptyState.js';

describe('EmptyState', () => {
  it('renderiza solo el título cuando es lo único provisto', () => {
    render(<EmptyState title="Sin resultados" />);
    expect(screen.getByText('Sin resultados')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('renderiza icono, título, descripción y action juntos', () => {
    render(
      <EmptyState
        icon={<svg data-testid="icon-mock" aria-label="placeholder icon" />}
        title="Aún no hay nada"
        description="Cuando exista, lo verás acá."
        action={<a href="/x">Crear primero</a>}
      />,
    );
    expect(screen.getByTestId('icon-mock')).toBeInTheDocument();
    expect(screen.getByText('Aún no hay nada')).toBeInTheDocument();
    expect(screen.getByText('Cuando exista, lo verás acá.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Crear primero/ })).toBeInTheDocument();
  });

  it('omite la descripción si no se provee', () => {
    render(<EmptyState title="Sin descripción" />);
    expect(screen.getByText('Sin descripción')).toBeInTheDocument();
    // El componente no debería renderizar otros <p> además del título.
    expect(screen.getAllByText(/.+/).length).toBe(1);
  });

  it('omite el icono si no se provee', () => {
    render(<EmptyState title="Sin ícono" />);
    expect(screen.queryByTestId('icon-mock')).not.toBeInTheDocument();
  });

  it('omite el action si no se provee', () => {
    render(<EmptyState title="Sin CTA" description="Solo texto." />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
