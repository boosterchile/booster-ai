import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const envState: { value: { VITE_GOOGLE_MAPS_API_KEY?: string } } = { value: {} };
vi.mock('../../lib/env.js', () => ({
  env: new Proxy(
    {},
    {
      get: (_t, prop: string) => envState.value[prop as 'VITE_GOOGLE_MAPS_API_KEY'],
    },
  ),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a>,
}));

vi.mock('@vis.gl/react-google-maps', () => ({
  APIProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="api-provider">{children}</div>
  ),
  Map: ({ children }: { children: ReactNode }) => <div data-testid="google-map">{children}</div>,
  AdvancedMarker: ({ children }: { children: ReactNode }) => (
    <div data-testid="marker">{children}</div>
  ),
  Pin: (props: { background?: string }) => <div data-testid="pin" data-bg={props.background} />,
  ControlPosition: { RIGHT_TOP: 'RIGHT_TOP' },
}));

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

const { LiveTrackingScreen } = await import('./LiveTrackingScreen.js');

beforeEach(() => {
  vi.clearAllMocks();
  followFollowing = true;
  envState.value = { VITE_GOOGLE_MAPS_API_KEY: 'test-key' };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LiveTrackingScreen — header', () => {
  it('renderiza título + back link', () => {
    render(
      <LiveTrackingScreen
        title="Vehículo ABCD12"
        backTo="/app"
        latitude={-33.45}
        longitude={-70.65}
      />,
    );
    expect(screen.getByText('Vehículo ABCD12')).toBeInTheDocument();
    expect(screen.getByLabelText('Volver')).toHaveAttribute('to', '/app');
  });

  it('subtitle opcional → si presente, se renderiza', () => {
    render(
      <LiveTrackingScreen
        title="V1"
        subtitle="Carga BST-001"
        backTo="/app"
        latitude={-33.45}
        longitude={-70.65}
      />,
    );
    expect(screen.getByText('Carga BST-001')).toBeInTheDocument();
  });

  it('onRefresh presente → muestra botón Refrescar', () => {
    const onRefresh = vi.fn();
    render(
      <LiveTrackingScreen
        title="V1"
        backTo="/app"
        latitude={-33.45}
        longitude={-70.65}
        onRefresh={onRefresh}
      />,
    );
    fireEvent.click(screen.getByLabelText('Refrescar'));
    expect(onRefresh).toHaveBeenCalled();
  });

  it('onRefresh ausente → no muestra botón', () => {
    render(<LiveTrackingScreen title="V1" backTo="/app" latitude={-33.45} longitude={-70.65} />);
    expect(screen.queryByLabelText('Refrescar')).not.toBeInTheDocument();
  });

  it('isFetching=true → botón Refrescar deshabilitado', () => {
    render(
      <LiveTrackingScreen
        title="V1"
        backTo="/app"
        latitude={-33.45}
        longitude={-70.65}
        onRefresh={vi.fn()}
        isFetching
      />,
    );
    expect(screen.getByLabelText('Refrescar')).toBeDisabled();
  });
});

describe('LiveTrackingScreen — empty states', () => {
  it('sin API key → "Mapa no disponible"', () => {
    envState.value = {};
    render(<LiveTrackingScreen title="V1" backTo="/app" latitude={-33.45} longitude={-70.65} />);
    expect(screen.getByText('Mapa no disponible')).toBeInTheDocument();
  });

  it('con API key pero lat null → "Sin posición GPS aún"', () => {
    render(<LiveTrackingScreen title="V1" backTo="/app" latitude={null} longitude={null} />);
    expect(screen.getByText('Sin posición GPS aún')).toBeInTheDocument();
  });

  it('con API key + lat null + isLoading → "Cargando…"', () => {
    render(
      <LiveTrackingScreen title="V1" backTo="/app" latitude={null} longitude={null} isLoading />,
    );
    expect(screen.getByText('Cargando…')).toBeInTheDocument();
  });
});

describe('LiveTrackingScreen — happy path', () => {
  it('lat+lng → renderiza GoogleMap + AdvancedMarker', () => {
    render(<LiveTrackingScreen title="V1" backTo="/app" latitude={-33.45} longitude={-70.65} />);
    expect(screen.getByTestId('google-map')).toBeInTheDocument();
    expect(screen.getByTestId('marker')).toBeInTheDocument();
  });

  it('speedKmh + angleDeg presentes → bottom card muestra valores', () => {
    render(
      <LiveTrackingScreen
        title="V1"
        backTo="/app"
        latitude={-33.45}
        longitude={-70.65}
        speedKmh={62}
        angleDeg={180}
      />,
    );
    expect(screen.getByText('62 km/h')).toBeInTheDocument();
    expect(screen.getByText('180°')).toBeInTheDocument();
  });

  it('speedKmh null → muestra "—"', () => {
    render(
      <LiveTrackingScreen
        title="V1"
        backTo="/app"
        latitude={-33.45}
        longitude={-70.65}
        speedKmh={null}
      />,
    );
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1);
  });

  it('timestamp viejo (>120s) → pin gris (stale)', () => {
    const oldDate = new Date(Date.now() - 5 * 60_000).toISOString();
    render(
      <LiveTrackingScreen
        title="V1"
        backTo="/app"
        latitude={-33.45}
        longitude={-70.65}
        timestampDevice={oldDate}
      />,
    );
    expect(screen.getByTestId('pin')).toHaveAttribute('data-bg', '#9CA3AF');
  });

  it('timestamp reciente → pin verde', () => {
    const fresh = new Date(Date.now() - 10_000).toISOString();
    render(
      <LiveTrackingScreen
        title="V1"
        backTo="/app"
        latitude={-33.45}
        longitude={-70.65}
        timestampDevice={fresh}
      />,
    );
    expect(screen.getByTestId('pin')).toHaveAttribute('data-bg', '#1FA058');
  });

  it('bottomExtra slot → se renderiza dentro del bottom card', () => {
    render(
      <LiveTrackingScreen
        title="V1"
        backTo="/app"
        latitude={-33.45}
        longitude={-70.65}
        bottomExtra={<div data-testid="extra-content">extra</div>}
      />,
    );
    expect(screen.getByTestId('extra-content')).toBeInTheDocument();
  });
});

describe('LiveTrackingScreen — recenter button', () => {
  it('follow=true (default) → no muestra botón Recentrar', () => {
    followFollowing = true;
    render(<LiveTrackingScreen title="V1" backTo="/app" latitude={-33.45} longitude={-70.65} />);
    expect(screen.queryByLabelText('Recentrar mapa en el vehículo')).not.toBeInTheDocument();
  });

  it('follow=false → muestra botón Recentrar y click llama resume', () => {
    followFollowing = false;
    render(<LiveTrackingScreen title="V1" backTo="/app" latitude={-33.45} longitude={-70.65} />);
    const btn = screen.getByLabelText('Recentrar mapa en el vehículo');
    fireEvent.click(btn);
    expect(resumeMock).toHaveBeenCalled();
  });

  it('follow=false pero sin posición → no botón (porque no hay mapa)', () => {
    followFollowing = false;
    render(<LiveTrackingScreen title="V1" backTo="/app" latitude={null} longitude={null} />);
    expect(screen.queryByLabelText('Recentrar mapa en el vehículo')).not.toBeInTheDocument();
  });
});
