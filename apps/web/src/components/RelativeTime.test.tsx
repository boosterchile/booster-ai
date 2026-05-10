import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RelativeTime } from './RelativeTime.js';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-10T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('RelativeTime', () => {
  it('null → fallback default "—"', () => {
    render(<RelativeTime date={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('null + fallback custom', () => {
    render(<RelativeTime date={undefined} fallback="sin dato" />);
    expect(screen.getByText('sin dato')).toBeInTheDocument();
  });

  it('Date 30s atrás → "hace 30s"', () => {
    render(<RelativeTime date={new Date('2026-05-10T11:59:30Z')} />);
    expect(screen.getByText('hace 30s')).toBeInTheDocument();
  });

  it('ISO string 5 min atrás → "hace 5 min"', () => {
    render(<RelativeTime date="2026-05-10T11:55:00Z" />);
    expect(screen.getByText('hace 5 min')).toBeInTheDocument();
  });

  it('renderiza <time> con dateTime ISO', () => {
    const { container } = render(<RelativeTime date="2026-05-10T11:55:00Z" />);
    const timeEl = container.querySelector('time');
    expect(timeEl?.getAttribute('datetime')).toBe('2026-05-10T11:55:00.000Z');
  });

  it('color class fresh (< 5 min default)', () => {
    const { container } = render(<RelativeTime date={new Date('2026-05-10T11:59:30Z')} />);
    const timeEl = container.querySelector('time');
    expect(timeEl?.className).toContain('text-neutral-700');
  });

  it('color class old (≥ 1 h default)', () => {
    const { container } = render(<RelativeTime date={new Date('2026-05-10T10:00:00Z')} />);
    const timeEl = container.querySelector('time');
    expect(timeEl?.className).toContain('text-rose-700');
  });

  it('thresholds custom respetados', () => {
    const { container } = render(
      <RelativeTime
        date={new Date('2026-05-10T11:59:50Z')}
        thresholds={{ staleSeconds: 5, oldSeconds: 30 }}
      />,
    );
    const timeEl = container.querySelector('time');
    // 10s atrás con stale=5 → stale
    expect(timeEl?.className).toContain('text-amber-700');
  });

  it('className prop se concatena', () => {
    const { container } = render(<RelativeTime date={null} className="extra-class" />);
    const span = container.querySelector('span');
    expect(span?.className).toContain('extra-class');
  });

  it('refreshIntervalMs=0 deshabilita auto-refresh', () => {
    render(<RelativeTime date={new Date('2026-05-10T11:59:30Z')} refreshIntervalMs={0} />);
    expect(screen.getByText('hace 30s')).toBeInTheDocument();
    vi.advanceTimersByTime(60_000);
    expect(screen.getByText('hace 30s')).toBeInTheDocument();
  });

  it('refreshIntervalMs default 30s — el setInterval se registra (smoke)', () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    render(<RelativeTime date={new Date('2026-05-10T11:59:30Z')} />);
    expect(screen.getByText('hace 30s')).toBeInTheDocument();
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 30_000);
  });

  it('fecha inválida → renderiza fallback en label sin crashear', () => {
    render(<RelativeTime date="not-a-date" />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
