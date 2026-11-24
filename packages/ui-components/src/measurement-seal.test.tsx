import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MeasurementSeal } from './measurement-seal.js';
import { axeCheck } from './test-utils.js';

describe('MeasurementSeal', () => {
  it('measured muestra la palabra «Medido»', () => {
    render(<MeasurementSeal kind="measured" />);
    expect(screen.getByText('Medido')).toBeDefined();
  });

  it('estimated muestra la palabra «Estimado»', () => {
    render(<MeasurementSeal kind="estimated" />);
    expect(screen.getByText('Estimado')).toBeDefined();
  });

  it('cada tipo tiene forma propia: borde continuo vs punteado e ícono distinto', () => {
    const { container: medido } = render(<MeasurementSeal kind="measured" />);
    const { container: estimado } = render(<MeasurementSeal kind="estimated" />);
    const elMedido = medido.firstElementChild as HTMLElement;
    const elEstimado = estimado.firstElementChild as HTMLElement;

    expect(elMedido.className).not.toContain('border-dashed');
    expect(elEstimado.className).toContain('border-dashed');

    const iconoMedido = elMedido.querySelector('svg')?.innerHTML;
    const iconoEstimado = elEstimado.querySelector('svg')?.innerHTML;
    expect(iconoMedido).toBeTruthy();
    expect(iconoEstimado).toBeTruthy();
    expect(iconoMedido).not.toBe(iconoEstimado);
  });

  it('el ícono es decorativo: el nombre accesible es solo la palabra', () => {
    const { container } = render(<MeasurementSeal kind="measured" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(el.textContent).toBe('Medido');
  });

  it('expone el tipo en data-kind', () => {
    const { container } = render(<MeasurementSeal kind="estimated" />);
    expect((container.firstElementChild as HTMLElement).dataset.kind).toBe('estimated');
  });

  it('NO depende de acento ni de registro', () => {
    for (const kind of ['measured', 'estimated'] as const) {
      const { container, unmount } = render(<MeasurementSeal kind={kind} />);
      const el = container.firstElementChild as HTMLElement;
      expect(el.className).not.toContain('accent');
      expect(el.getAttribute('style')).toBeNull();
      unmount();
    }
  });

  it('mergea className del consumidor y reenvía atributos', () => {
    const { container } = render(
      <MeasurementSeal kind="measured" className="ml-2" data-testid="sello" />,
    );
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain('ml-2');
    expect(el.dataset.testid).toBe('sello');
  });

  it('sin violaciones de a11y', async () => {
    const { container } = render(
      <p>
        Huella del viaje <MeasurementSeal kind="measured" />
        <MeasurementSeal kind="estimated" />
      </p>,
    );
    expect(await axeCheck(container)).toHaveNoViolations();
  });
});
