import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Badge } from './badge.js';
import { axeCheck } from './test-utils.js';

describe('Badge', () => {
  it('comunica el estado por texto (children), no solo por color', () => {
    render(<Badge variant="success">Entregado</Badge>);
    expect(screen.getByText('Entregado')).toBeDefined();
  });

  it('sin violaciones de a11y', async () => {
    const { container } = render(<Badge variant="error">Rechazado</Badge>);
    expect(await axeCheck(container)).toHaveNoViolations();
  });

  it('cada variante usa su par semántico FIJO de D1 (error → danger)', () => {
    const cases: Array<[import('./badge.js').BadgeVariant, string, string]> = [
      ['success', 'bg-success-50', 'text-success-700'],
      ['error', 'bg-danger-50', 'text-danger-700'],
      ['warning', 'bg-warning-50', 'text-warning-700'],
      ['info', 'bg-info-50', 'text-info-700'],
      ['neutral', 'bg-neutral-100', 'text-neutral-700'],
    ];
    for (const [variant, bg, fg] of cases) {
      const { container, unmount } = render(<Badge variant={variant}>x</Badge>);
      const cls = (container.firstElementChild as HTMLElement).className;
      expect(cls).toContain(bg);
      expect(cls).toContain(fg);
      unmount();
    }
  });

  it('NO depende de acento ni de registro (no lee --accent-* ni custom properties de tamaño)', () => {
    const { container } = render(<Badge variant="info">Info</Badge>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).not.toContain('accent');
    // no consume las custom properties de registro/densidad de Ola 0
    expect(el.getAttribute('style')).toBeNull();
    expect(el.className).not.toContain('touch-min');
    expect(el.className).not.toContain('--pad');
  });
});
