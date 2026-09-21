import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PublicTrackingShare } from './public-tracking-share.js';

const URL = 'https://app.boosterchile.com/tracking/550e8400-e29b-4114-a716-446655440000';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('PublicTrackingShare', () => {
  it('muestra el enlace y copia al portapapeles', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<PublicTrackingShare url={URL} />);
    expect(screen.getByRole('link', { name: /seguimiento público/i })).toHaveAttribute('href', URL);
    fireEvent.click(screen.getByRole('button', { name: 'Copiar enlace' }));
    expect(await screen.findByRole('button', { name: 'Copiado' })).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(URL);
  });

  it('si el portapapeles falla, el enlace sigue visible', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<PublicTrackingShare url={URL} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copiar enlace' }));
    expect(await screen.findByRole('link', { name: /seguimiento público/i })).toHaveAttribute(
      'href',
      URL,
    );
    expect(screen.getByRole('button', { name: 'Copiar enlace' })).toBeInTheDocument();
  });
});
