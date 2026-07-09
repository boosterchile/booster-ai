import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Modal } from './modal.js';
import { RegisterProvider } from './register-provider.js';
import { axeCheck } from './test-utils.js';

describe('Modal', () => {
  it('abierto: renderiza role=dialog con nombre accesible (title)', () => {
    render(
      <Modal isOpen onOpenChange={() => {}} title="Confirmar acción">
        Contenido del modal
      </Modal>,
    );
    expect(screen.getByRole('dialog', { name: 'Confirmar acción' })).toBeDefined();
    expect(screen.getByText('Contenido del modal')).toBeDefined();
  });

  it('cerrado: no renderiza el dialog', () => {
    render(
      <Modal isOpen={false} onOpenChange={() => {}} title="X">
        c
      </Modal>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('sin title usa aria-label como nombre accesible', () => {
    render(
      <Modal isOpen onOpenChange={() => {}} aria-label="Detalle de carga">
        c
      </Modal>,
    );
    expect(screen.getByRole('dialog', { name: 'Detalle de carga' })).toBeDefined();
  });

  it('sin violaciones de a11y', async () => {
    const { baseElement } = render(
      <Modal isOpen onOpenChange={() => {}} title="Confirmar">
        Contenido
      </Modal>,
    );
    expect(await axeCheck(baseElement)).toHaveNoViolations();
  });

  it('re-aplica data-register/data-density en el portal (leídos de useRegister)', () => {
    const { baseElement } = render(
      <RegisterProvider register="conductor" density="compacta">
        <Modal isOpen onOpenChange={() => {}} title="X">
          c
        </Modal>
      </RegisterProvider>,
    );
    // El overlay porteado (fuera del wrapper) DEBE llevar el registro re-aplicado.
    const overlay = baseElement.querySelector('[data-register]');
    expect(overlay?.getAttribute('data-register')).toBe('conductor');
    expect(overlay?.getAttribute('data-density')).toBe('compacta');
  });

  it('el box del modal consume las custom properties de registro (var(--pad-y))', () => {
    render(
      <Modal isOpen onOpenChange={() => {}} title="X" data-testid="modal-box">
        c
      </Modal>,
    );
    const box = screen.getByTestId('modal-box');
    expect(box.style.paddingBlock).toBe('var(--pad-y)');
    expect(box.style.paddingInline).toBe('var(--pad-x)');
  });

  it('children render-prop puede cerrar (onOpenChange false)', () => {
    const onOpenChange = vi.fn();
    render(
      <Modal isOpen onOpenChange={onOpenChange} title="X">
        {({ close }) => (
          <button type="button" onClick={close}>
            Cerrar
          </button>
        )}
      </Modal>,
    );
    fireEvent.click(screen.getByText('Cerrar'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('Esc cierra siempre (onOpenChange false)', () => {
    const onOpenChange = vi.fn();
    render(
      <Modal isOpen onOpenChange={onOpenChange} title="X">
        c
      </Modal>,
    );
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('acepta isDismissable=false (confirmaciones destructivas)', () => {
    render(
      <Modal isOpen onOpenChange={() => {}} isDismissable={false} title="Cancelar flete">
        c
      </Modal>,
    );
    expect(screen.getByRole('dialog', { name: 'Cancelar flete' })).toBeDefined();
  });
});
