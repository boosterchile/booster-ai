import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const envMock = { VITE_GOOGLE_MAPS_API_KEY: '' as string | undefined };
vi.mock('../../lib/env.js', () => ({
  get env() {
    return envMock;
  },
}));

vi.mock('@vis.gl/react-google-maps', () => ({
  APIProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="api-provider">{children}</div>
  ),
  Map: ({
    children,
    defaultCenter,
    defaultZoom,
  }: {
    children: ReactNode;
    defaultCenter: { lat: number; lng: number };
    defaultZoom: number;
  }) => (
    <div
      data-testid="google-map"
      data-lat={String(defaultCenter.lat)}
      data-lng={String(defaultCenter.lng)}
      data-zoom={String(defaultZoom)}
    >
      {children}
    </div>
  ),
  AdvancedMarker: ({
    position,
    title,
    children,
  }: {
    position: { lat: number; lng: number };
    title: string;
    children: ReactNode;
  }) => (
    <div
      data-testid="marker"
      data-title={title}
      data-lat={String(position.lat)}
      data-lng={String(position.lng)}
    >
      {children}
    </div>
  ),
  Pin: () => <span data-testid="pin" />,
}));

const { EventoCombustibleMap } = await import('./EventoCombustibleMap.js');

beforeEach(() => {
  envMock.VITE_GOOGLE_MAPS_API_KEY = '';
});

describe('EventoCombustibleMap', () => {
  it('sin key no monta un pin', () => {
    render(<EventoCombustibleMap latitude={-33.4} longitude={-70.6} />);
    expect(screen.getByText('Mapa no disponible')).toBeInTheDocument();
    expect(screen.queryByTestId('pin')).not.toBeInTheDocument();
    expect(screen.queryByTestId('google-map')).not.toBeInTheDocument();
  });

  it('centra el mapa y el pin en la coordenada del evento', () => {
    envMock.VITE_GOOGLE_MAPS_API_KEY = 'test-key';
    render(<EventoCombustibleMap latitude={-33.4} longitude={-70.6} />);
    const mapa = screen.getByTestId('google-map');
    expect(mapa).toHaveAttribute('data-lat', '-33.4');
    expect(mapa).toHaveAttribute('data-lng', '-70.6');
    expect(mapa).toHaveAttribute('data-zoom', '16');
    const pin = screen.getByTestId('marker');
    expect(pin).toHaveAttribute('data-lat', '-33.4');
    expect(pin).toHaveAttribute('data-lng', '-70.6');
    expect(pin).toHaveAttribute('data-title', 'Posible robo de combustible');
    expect(screen.getByTestId('pin')).toBeInTheDocument();
  });
});
