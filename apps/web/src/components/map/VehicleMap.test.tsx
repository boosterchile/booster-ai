import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const envState: { value: { VITE_GOOGLE_MAPS_API_KEY?: string } } = { value: {} };
vi.mock('../../lib/env.js', () => ({
  env: new Proxy(
    {},
    {
      get: (_t, prop: string) => envState.value[prop as 'VITE_GOOGLE_MAPS_API_KEY'],
    },
  ),
}));

// Mock @vis.gl/react-google-maps con stubs simples — no podemos cargar el
// SDK real sin browser ni API key válida.
vi.mock('@vis.gl/react-google-maps', () => ({
  APIProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="api-provider">{children}</div>
  ),
  Map: ({ children, style }: { children: ReactNode; style?: { height: number } }) => (
    <div data-testid="google-map" style={style}>
      {children}
    </div>
  ),
  AdvancedMarker: ({ children, title }: { children: ReactNode; title: string }) => (
    <div data-testid="marker" data-title={title}>
      {children}
    </div>
  ),
  Pin: () => <div data-testid="pin" />,
  MapControl: ({ children }: { children: ReactNode }) => (
    <div data-testid="map-control">{children}</div>
  ),
  ControlPosition: { RIGHT_BOTTOM: 'RIGHT_BOTTOM' },
}));

// useFollowVehicle stub: simple controller object.
let followFollowing = true;
const resumeMock = vi.fn();
vi.mock('./use-follow-vehicle.js', () => ({
  useFollowVehicle: () => ({
    get following() {
      return followFollowing;
    },
    pause: vi.fn(),
    resume: resumeMock,
  }),
  FollowVehicle: () => <div data-testid="follow-vehicle" />,
}));

const { VehicleMap } = await import('./VehicleMap.js');

beforeEach(() => {
  vi.clearAllMocks();
  followFollowing = true;
  envState.value = {};
});

describe('VehicleMap — fallbacks', () => {
  it('sin VITE_GOOGLE_MAPS_API_KEY → render "Mapa no disponible"', () => {
    // El setup global no setea la API key; env.VITE_GOOGLE_MAPS_API_KEY es undefined.
    render(<VehicleMap latitude={-33.45} longitude={-70.65} plate="ABCD12" />);
    expect(screen.getByText('Mapa no disponible')).toBeInTheDocument();
  });

  it('con API key pero lat/lng null → "Sin posición GPS aún"', () => {
    envState.value = { VITE_GOOGLE_MAPS_API_KEY: 'test-key' };
    render(<VehicleMap latitude={null} longitude={null} plate="ABCD12" />);
    expect(screen.getByText('Sin posición GPS aún')).toBeInTheDocument();
  });

  it('lat presente y lng null → fallback "Sin posición GPS"', () => {
    envState.value = { VITE_GOOGLE_MAPS_API_KEY: 'test-key' };
    render(<VehicleMap latitude={-33.45} longitude={null} plate="ABCD12" />);
    expect(screen.getByText('Sin posición GPS aún')).toBeInTheDocument();
  });
});

describe('VehicleMap — happy path', () => {
  beforeEach(() => {
    envState.value = { VITE_GOOGLE_MAPS_API_KEY: 'test-key' };
  });

  it('renderiza GoogleMap + AdvancedMarker + label de placa', () => {
    render(<VehicleMap latitude={-33.45} longitude={-70.65} plate="ABCD12" speedKmh={42} />);
    expect(screen.getByTestId('google-map')).toBeInTheDocument();
    expect(screen.getByTestId('marker')).toHaveAttribute(
      'data-title',
      expect.stringContaining('ABCD12'),
    );
    expect(screen.getByTestId('marker')).toHaveAttribute(
      'data-title',
      expect.stringContaining('42 km/h'),
    );
  });

  it('speedKmh null → label "Detenido o sin velocidad"', () => {
    render(<VehicleMap latitude={-33.45} longitude={-70.65} plate="ABCD12" speedKmh={null} />);
    expect(screen.getByText('Detenido o sin velocidad')).toBeInTheDocument();
  });

  it('speedKmh undefined → label "Detenido"', () => {
    render(<VehicleMap latitude={-33.45} longitude={-70.65} plate="ABCD12" />);
    expect(screen.getByText('Detenido o sin velocidad')).toBeInTheDocument();
  });

  it('timestampDevice presente → muestra "Reportado" + fecha localizada', () => {
    render(
      <VehicleMap
        latitude={-33.45}
        longitude={-70.65}
        plate="ABCD12"
        timestampDevice="2026-05-10T15:30:00Z"
      />,
    );
    expect(screen.getByText(/Reportado/)).toBeInTheDocument();
  });

  it('timestampDevice Date object → también funciona', () => {
    render(
      <VehicleMap
        latitude={-33.45}
        longitude={-70.65}
        plate="ABCD12"
        timestampDevice={new Date('2026-05-10T15:30:00Z')}
      />,
    );
    expect(screen.getByText(/Reportado/)).toBeInTheDocument();
  });

  it('follow=true (default) → no muestra botón Recentrar', () => {
    followFollowing = true;
    render(<VehicleMap latitude={-33.45} longitude={-70.65} plate="ABCD12" />);
    expect(screen.queryByLabelText('Recentrar mapa en el vehículo')).not.toBeInTheDocument();
  });

  it('follow=false → muestra botón Recentrar dentro de MapControl', () => {
    followFollowing = false;
    render(<VehicleMap latitude={-33.45} longitude={-70.65} plate="ABCD12" />);
    expect(screen.getByLabelText('Recentrar mapa en el vehículo')).toBeInTheDocument();
  });

  it('height prop custom → aplica al style del Map', () => {
    render(<VehicleMap latitude={-33.45} longitude={-70.65} plate="ABCD12" height={500} />);
    const map = screen.getByTestId('google-map');
    expect(map).toHaveStyle({ height: '500px' });
  });
});
