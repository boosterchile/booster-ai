import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Card, CardBody, CardFooter, CardHeader } from './card.js';
import { axeCheck } from './test-utils.js';

describe('Card', () => {
  it('compone Header/Body/Footer y renderiza su contenido', () => {
    render(
      <Card>
        <CardHeader>Título</CardHeader>
        <CardBody>Contenido</CardBody>
        <CardFooter>Pie</CardFooter>
      </Card>,
    );
    expect(screen.getByText('Título')).toBeDefined();
    expect(screen.getByText('Contenido')).toBeDefined();
    expect(screen.getByText('Pie')).toBeDefined();
  });

  it('sin violaciones de a11y', async () => {
    const { container } = render(
      <Card>
        <CardHeader>Título</CardHeader>
        <CardBody>Contenido</CardBody>
      </Card>,
    );
    expect(await axeCheck(container)).toHaveNoViolations();
  });

  it('el padding de sección responde al registro vía custom properties (no reimplementa)', () => {
    render(
      <Card>
        <CardBody data-testid="body">x</CardBody>
      </Card>,
    );
    const body = screen.getByTestId('body');
    expect(body.style.paddingBlock).toBe('var(--pad-y)');
    expect(body.style.paddingInline).toBe('var(--pad-x)');
  });

  it('la envoltura usa tokens D1 (borde/radio/fondo), sin lógica', () => {
    const { container } = render(<Card>x</Card>);
    const cls = (container.firstElementChild as HTMLElement).className;
    expect(cls).toContain('rounded-lg');
    expect(cls).toContain('border-neutral-200');
    expect(cls).toContain('bg-neutral-0');
  });

  it('mergea className del consumidor', () => {
    const { container } = render(<Card className="max-w-md">x</Card>);
    expect((container.firstElementChild as HTMLElement).className).toContain('max-w-md');
  });
});
