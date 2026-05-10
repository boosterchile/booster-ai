import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MembershipPayload } from '../hooks/use-me.js';
import { CompanySwitcher } from './CompanySwitcher.js';

function membership(
  id: string,
  name: string,
  status: MembershipPayload['status'] = 'activa',
  role: MembershipPayload['role'] = 'dueno',
): MembershipPayload {
  return {
    id: `m-${id}`,
    role,
    status,
    joined_at: '2026-01-01T00:00:00Z',
    empresa: {
      id,
      legal_name: name,
      rut: '76.123.456-7',
      is_generador_carga: true,
      is_transportista: false,
      status: 'activa',
    },
  };
}

describe('CompanySwitcher', () => {
  it('no renderiza nada si no hay memberships activas', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <CompanySwitcher
        memberships={[membership('1', 'Empresa A', 'pendiente_invitacion')]}
        activeEmpresaId={null}
        onSelect={onSelect}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('con 1 sola empresa activa muestra solo el nombre (sin dropdown)', () => {
    const onSelect = vi.fn();
    render(
      <CompanySwitcher
        memberships={[membership('1', 'Empresa A')]}
        activeEmpresaId="1"
        onSelect={onSelect}
      />,
    );
    expect(screen.getByText('Empresa A')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('con 2 empresas activas muestra el trigger del dropdown', () => {
    const onSelect = vi.fn();
    render(
      <CompanySwitcher
        memberships={[membership('1', 'Empresa A'), membership('2', 'Empresa B')]}
        activeEmpresaId="1"
        onSelect={onSelect}
      />,
    );
    const trigger = screen.getByRole('button');
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Empresa A')).toBeInTheDocument();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('click en el trigger abre el menu con las opciones', () => {
    const onSelect = vi.fn();
    render(
      <CompanySwitcher
        memberships={[membership('1', 'Empresa A'), membership('2', 'Empresa B')]}
        activeEmpresaId="1"
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Empresa A/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Empresa B/ })).toBeInTheDocument();
  });

  it('la opción activa está deshabilitada y marcada con check', () => {
    const onSelect = vi.fn();
    render(
      <CompanySwitcher
        memberships={[membership('1', 'Empresa A'), membership('2', 'Empresa B')]}
        activeEmpresaId="1"
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    const itemA = screen.getByRole('menuitem', { name: /Empresa A/ });
    expect(itemA).toBeDisabled();
    expect(screen.getByLabelText('Activa')).toBeInTheDocument();
  });

  it('click en otra opción invoca onSelect con el empresaId', () => {
    const onSelect = vi.fn();
    render(
      <CompanySwitcher
        memberships={[membership('1', 'Empresa A'), membership('2', 'Empresa B')]}
        activeEmpresaId="1"
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByRole('menuitem', { name: /Empresa B/ }));
    expect(onSelect).toHaveBeenCalledWith('2');
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('filtra memberships no activas (pendiente, suspendida, removida)', () => {
    const onSelect = vi.fn();
    render(
      <CompanySwitcher
        memberships={[
          membership('1', 'Empresa A'),
          membership('2', 'Empresa B'),
          membership('3', 'Empresa C', 'pendiente_invitacion'),
          membership('4', 'Empresa D', 'suspendida'),
        ]}
        activeEmpresaId="1"
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('menuitem', { name: /Empresa A/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Empresa B/ })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Empresa C/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Empresa D/ })).not.toBeInTheDocument();
  });

  it('press Escape cierra el menu', () => {
    const onSelect = vi.fn();
    render(
      <CompanySwitcher
        memberships={[membership('1', 'Empresa A'), membership('2', 'Empresa B')]}
        activeEmpresaId="1"
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('press tecla cualquiera no cierra el menu', () => {
    render(
      <CompanySwitcher
        memberships={[membership('1', 'Empresa A'), membership('2', 'Empresa B')]}
        activeEmpresaId="1"
        onSelect={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    fireEvent.keyDown(document, { key: 'A' });
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('click fuera del container cierra el menu', () => {
    render(
      <div>
        <CompanySwitcher
          memberships={[membership('1', 'Empresa A'), membership('2', 'Empresa B')]}
          activeEmpresaId="1"
          onSelect={vi.fn()}
        />
        <button type="button" data-testid="outside">
          fuera
        </button>
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Empresa A/ }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('disabled=true → trigger deshabilitado', () => {
    render(
      <CompanySwitcher
        memberships={[membership('1', 'Empresa A'), membership('2', 'Empresa B')]}
        activeEmpresaId="1"
        onSelect={vi.fn()}
        disabled
      />,
    );
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('activeEmpresaId no encontrado → fallback al primer activo', () => {
    render(
      <CompanySwitcher
        memberships={[membership('1', 'Empresa A'), membership('2', 'Empresa B')]}
        activeEmpresaId="zzz-no-existe"
        onSelect={vi.fn()}
      />,
    );
    // Active es Empresa A (el primero del array filtrado).
    const trigger = screen.getByRole('button');
    expect(trigger).toHaveTextContent('Empresa A');
  });

  describe('roleLabel branches', () => {
    const cases = [
      ['admin', 'Administrador'],
      ['despachador', 'Despachador'],
      ['conductor', 'Conductor'],
      ['visualizador', 'Visualizador'],
      ['stakeholder_sostenibilidad', 'Stakeholder'],
    ] as const;

    for (const [role, label] of cases) {
      it(`role=${role} → label "${label}"`, () => {
        render(
          <CompanySwitcher
            memberships={[
              membership('1', 'Empresa A', 'activa', role),
              membership('2', 'Empresa B'),
            ]}
            activeEmpresaId="1"
            onSelect={vi.fn()}
          />,
        );
        fireEvent.click(screen.getByRole('button'));
        expect(screen.getByText(label)).toBeInTheDocument();
      });
    }
  });
});
