import { renderHook } from '@testing-library/react';
import type { FieldErrors } from 'react-hook-form';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useScrollToFirstError } from './use-scroll-to-first-error.js';

function mockEl(id: string): HTMLInputElement {
  const input = document.createElement('input');
  input.id = id;
  input.name = id;
  document.body.appendChild(input);
  input.scrollIntoView = vi.fn();
  input.focus = vi.fn();
  return input;
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useScrollToFirstError', () => {
  it('submitCount=0 → no hace nada', () => {
    const el = mockEl('full_name');
    const errors: FieldErrors = { full_name: { type: 'required', message: 'req' } };
    renderHook(() => useScrollToFirstError(errors, 0));
    expect(el.scrollIntoView).not.toHaveBeenCalled();
  });

  it('errors vacío → no hace nada', () => {
    const el = mockEl('full_name');
    renderHook(() => useScrollToFirstError({}, 1));
    expect(el.scrollIntoView).not.toHaveBeenCalled();
  });

  it('error simple → scroll + focus al elemento by id', () => {
    const el = mockEl('email');
    const errors: FieldErrors = { email: { type: 'required', message: 'req' } };
    renderHook(() => useScrollToFirstError(errors, 1));
    expect(el.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
    vi.advanceTimersByTime(60);
    expect(el.focus).toHaveBeenCalled();
  });

  it('error nested (user.full_name) → scroll al elemento con id dot-notation', () => {
    const el = mockEl('user.full_name');
    const errors: FieldErrors = {
      user: {
        full_name: { type: 'required', message: 'req' },
      } as never,
    };
    renderHook(() => useScrollToFirstError(errors, 1));
    expect(el.scrollIntoView).toHaveBeenCalled();
  });

  it('elemento no existe → no falla', () => {
    const errors: FieldErrors = { ghost: { type: 'required', message: 'req' } };
    expect(() => renderHook(() => useScrollToFirstError(errors, 1))).not.toThrow();
  });

  it('fallback por [name=...] cuando no hay id', () => {
    const input = document.createElement('input');
    input.name = 'campo_x';
    document.body.appendChild(input);
    input.scrollIntoView = vi.fn();
    input.focus = vi.fn();
    const errors: FieldErrors = { campo_x: { type: 'required', message: 'req' } };
    renderHook(() => useScrollToFirstError(errors, 1));
    expect(input.scrollIntoView).toHaveBeenCalled();
  });
});
