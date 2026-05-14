import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { KpiCard } from './KpiCard.js';

describe('KpiCard', () => {
  it('renderiza label uppercase + value + description', () => {
    render(
      <KpiCard
        label="Cost MTD"
        value={<span>$100.000 CLP</span>}
        description="vs $90.000 mes anterior"
      />,
    );
    expect(screen.getByText('Cost MTD')).toBeInTheDocument();
    expect(screen.getByText('$100.000 CLP')).toBeInTheDocument();
    expect(screen.getByText('vs $90.000 mes anterior')).toBeInTheDocument();
  });

  it('aplica color de borde según status', () => {
    const { container } = render(<KpiCard label="Test" value="42" status="critical" />);
    const section = container.querySelector('section');
    expect(section?.className).toContain('border-l-danger-500');
  });

  it('data-testid generado en kebab-case desde label', () => {
    render(<KpiCard label="Cloud Run CPU" value="40%" />);
    expect(screen.getByTestId('kpi-cloud-run-cpu')).toBeInTheDocument();
  });

  it('omite description si no se pasa', () => {
    render(<KpiCard label="Test" value="42" />);
    expect(screen.queryByText(/description/i)).not.toBeInTheDocument();
  });
});
