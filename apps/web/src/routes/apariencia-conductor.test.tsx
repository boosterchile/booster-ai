import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

let searchMock: Record<string, unknown> = {};
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...props }: { children: ReactNode; to?: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useSearch: () => searchMock,
}));

vi.mock('../hooks/use-driver-position-reporter.js', () => ({
  useDriverPositionReporter: () => ({
    isWatching: false,
    lastPosition: null,
    lastError: null,
    pointsSent: 0,
    lastGeofence: null,
    start: vi.fn(),
    stop: vi.fn(),
  }),
}));

const { AparienciaConductorRoute } = await import('./apariencia-conductor.js');

afterEach(() => {
  searchMock = {};
});

describe('AparienciaConductorRoute — preview pública de la tarjeta del conductor', () => {
  it('por defecto: por recoger, con Teltonika → recogida como acción principal, camión reporta solo', () => {
    render(<AparienciaConductorRoute />);
    expect(screen.getByTestId('confirmar-recogida')).toBeInTheDocument();
    expect(screen.getByTestId('navegar-origen')).toBeInTheDocument();
    expect(screen.getByTestId('posicion-camion')).toBeInTheDocument();
    expect(screen.queryByTestId('navegar-destino')).toBeNull();
  });

  it('?fase=en_ruta&teltonika=0 (el router lo parsea como número) → entrega principal y aviso de posición', () => {
    searchMock = { fase: 'en_ruta', teltonika: 0 };
    render(<AparienciaConductorRoute />);
    expect(screen.getByTestId('confirmar-entrega')).toBeInTheDocument();
    expect(screen.getByTestId('navegar-destino')).toBeInTheDocument();
    expect(screen.getByTestId('gps-retry')).toBeInTheDocument();
    expect(screen.queryByTestId('confirmar-recogida')).toBeNull();
  });
});
