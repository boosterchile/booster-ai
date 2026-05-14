import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HealthIndicator } from './HealthIndicator.js';

describe('HealthIndicator', () => {
  it('renderiza label + message para healthy', () => {
    render(<HealthIndicator level="healthy" label="Uptime" message="99.9%" />);
    expect(screen.getByText('Uptime')).toBeInTheDocument();
    expect(screen.getByText('99.9%')).toBeInTheDocument();
  });

  it('aria-label incluye level y message', () => {
    render(<HealthIndicator level="degraded" label="CPU" message="78%" />);
    const el = screen.getByLabelText(/CPU: degraded — 78%/);
    expect(el).toBeInTheDocument();
  });

  it('omite message si no se pasa', () => {
    render(<HealthIndicator level="critical" label="Disk" />);
    expect(screen.getByText('Disk')).toBeInTheDocument();
    expect(screen.getByLabelText('Disk: critical')).toBeInTheDocument();
  });

  it('renderiza para todos los levels sin crashear', () => {
    const levels = ['healthy', 'degraded', 'critical', 'unknown'] as const;
    for (const level of levels) {
      const { unmount } = render(<HealthIndicator level={level} label={`Test-${level}`} />);
      expect(screen.getByText(`Test-${level}`)).toBeInTheDocument();
      unmount();
    }
  });
});
