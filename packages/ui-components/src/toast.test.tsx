import { zIndex } from '@booster-ai/ui-tokens';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axeCheck } from './test-utils.js';
import { type ToastOptions, ToastProvider, useToast } from './toast.js';

function Trigger({ options }: { options: ToastOptions }) {
  const { notify } = useToast();
  return (
    <button type="button" onClick={() => notify(options)}>
      Notificar
    </button>
  );
}

function renderWithToast(options: ToastOptions, providerDuration?: number) {
  const durationProp = providerDuration === undefined ? {} : { duration: providerDuration };
  const result = render(
    <ToastProvider {...durationProp}>
      <Trigger options={options} />
    </ToastProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Notificar' }));
  return result;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Toast', () => {
  it('notify muestra el toast con título y descripción', () => {
    renderWithToast({ title: 'Guardado', description: 'Cambios aplicados' });
    expect(screen.getByText('Guardado')).toBeDefined();
    expect(screen.getByText('Cambios aplicados')).toBeDefined();
  });

  it('severidad error → role=alert / aria-live=assertive', () => {
    renderWithToast({ title: 'Falló', severity: 'error' });
    const el = screen.getByRole('alert');
    expect(el.getAttribute('aria-live')).toBe('assertive');
  });

  it('severidad no-alta → role=status / aria-live=polite', () => {
    renderWithToast({ title: 'Ok', severity: 'success' });
    const el = screen.getByRole('status');
    expect(el.getAttribute('aria-live')).toBe('polite');
  });

  it('dismiss por teclado: el botón Cerrar (nativo, operable por teclado) quita el toast', () => {
    renderWithToast({ title: 'Guardado' });
    expect(screen.getByText('Guardado')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByText('Guardado')).toBeNull();
  });

  it('auto-cierra tras la duración (timer)', () => {
    vi.useFakeTimers();
    renderWithToast({ title: 'Efímero' }, 100);
    expect(screen.getByText('Efímero')).toBeDefined();
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(screen.queryByText('Efímero')).toBeNull();
  });

  it('duration <= 0 no auto-cierra (queda hasta dismiss manual)', () => {
    vi.useFakeTimers();
    renderWithToast({ title: 'Persistente', duration: 0 });
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(screen.getByText('Persistente')).toBeDefined();
  });

  it('NO roba el foco (no autofocus, no focus-trap)', () => {
    renderWithToast({ title: 'Guardado' });
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: 'Cerrar' }));
  });

  it('la región usa el z-index del token D1 y el padding responde al registro', () => {
    renderWithToast({ title: 'Guardado', severity: 'info' });
    const region = screen.getByRole('region', { name: 'Notificaciones' });
    expect(region.style.zIndex).toBe(String(zIndex.toast));
    expect(screen.getByRole('status').style.paddingBlock).toBe('var(--pad-y)');
  });

  it('useToast fuera del provider lanza', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Trigger options={{ title: 'x' }} />)).toThrow(/ToastProvider/);
    spy.mockRestore();
  });

  it('sin violaciones de a11y (portal en body)', async () => {
    const { baseElement } = renderWithToast({ title: 'Guardado', description: 'Listo' });
    expect(await axeCheck(baseElement)).toHaveNoViolations();
  });
});
