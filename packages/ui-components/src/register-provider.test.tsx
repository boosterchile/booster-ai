import { render, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { RegisterProvider, useRegister } from './register-provider.js';

describe('RegisterProvider', () => {
  it('co-loca data-register y data-density en el mismo ancestro (invariante del calc)', () => {
    const { container } = render(
      <RegisterProvider register="conductor" density="compacta">
        <span>hola</span>
      </RegisterProvider>,
    );
    const wrapper = container.querySelector('[data-register]');
    expect(wrapper?.getAttribute('data-register')).toBe('conductor');
    expect(wrapper?.getAttribute('data-density')).toBe('compacta');
  });

  it('sin props usa el default (operador / cómoda)', () => {
    const { container } = render(
      <RegisterProvider>
        <span>hola</span>
      </RegisterProvider>,
    );
    const wrapper = container.querySelector('[data-register]');
    expect(wrapper?.getAttribute('data-register')).toBe('operador');
    expect(wrapper?.getAttribute('data-density')).toBe('comoda');
  });

  it('pasa className al ancestro', () => {
    const { container } = render(
      <RegisterProvider className="grid gap-2">
        <span>hola</span>
      </RegisterProvider>,
    );
    expect(container.querySelector('[data-register]')?.getAttribute('class')).toBe('grid gap-2');
  });

  it('useRegister() lee el valor activo (caso raro)', () => {
    const { result } = renderHook(() => useRegister(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <RegisterProvider register="conductor" density="compacta">
          {children}
        </RegisterProvider>
      ),
    });
    expect(result.current).toEqual({ register: 'conductor', density: 'compacta' });
  });

  it('useRegister() fuera del provider devuelve el default', () => {
    const { result } = renderHook(() => useRegister());
    expect(result.current).toEqual({ register: 'operador', density: 'comoda' });
  });
});
