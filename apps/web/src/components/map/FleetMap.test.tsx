import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

vi.mock('@vis.gl/react-google-maps', () => ({
  APIProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="api-provider">{children}</div>
  ),
  Map: ({ children, style }: { children: ReactNode; style?: { height: number } }) => (
    <div data-testid="google-map" style={style}>
      {children}
    </div>
  ),
  AdvancedMarker: ({
    children,
    title,
    onClick,
  }: {
    children: ReactNode;
    title: string;
    onClick?: () => void;
  }) => (
    // biome-ignore lint/a11y/useKeyWithClickEvents: test stub
    <div data-testid="marker" data-title={title} onClick={onClick}>
      {children}
    </div>
  ),
  Pin: ({ background }: { background: string }) => <div data-testid="pin" data-bg={background} />,
  useMap: () => null,
  useMapsLibrary: () => null,
}));

const { FleetMap } = await import('./FleetMap.js');

beforeEach(() => {
  envState.value = {};
});

describe('FleetMap', () => {
  describe('fallbacks', () => {
    it('sin VITE_GOOGLE_MAPS_API_KEY → "Mapa no disponible"', () => {
      render(<FleetMap vehicles={[]} />);
      expect(screen.getByText('Mapa no disponible')).toBeInTheDocument();
    });

    it('con API key + 0 vehículos con posición → render mapa sin markers', () => {
      envState.value = { VITE_GOOGLE_MAPS_API_KEY: 'test-key' };
      render(<FleetMap vehicles={[]} />);
      expect(screen.getByTestId('google-map')).toBeInTheDocument();
      expect(screen.queryAllByTestId('marker')).toHaveLength(0);
    });
  });

  describe('rendering markers', () => {
    beforeEach(() => {
      envState.value = { VITE_GOOGLE_MAPS_API_KEY: 'test-key' };
    });

    it('renderiza 1 marker por vehículo con posición', () => {
      render(
        <FleetMap
          vehicles={[
            { id: 'v1', plate: 'BCDF12', latitude: -33.45, longitude: -70.65, speedKmh: 42 },
            { id: 'v2', plate: 'AAAA11', latitude: -33.46, longitude: -70.64, speedKmh: 0 },
          ]}
        />,
      );
      expect(screen.getAllByTestId('marker')).toHaveLength(2);
    });

    it('marker title incluye plate y speed', () => {
      render(
        <FleetMap
          vehicles={[
            { id: 'v1', plate: 'BCDF12', latitude: -33.45, longitude: -70.65, speedKmh: 42 },
          ]}
        />,
      );
      const marker = screen.getByTestId('marker');
      expect(marker.getAttribute('data-title')).toContain('BCDF12');
      expect(marker.getAttribute('data-title')).toContain('42 km/h');
    });

    it('vehículo con lat/lng no finitos se filtra silenciosamente', () => {
      render(
        <FleetMap
          vehicles={[
            {
              id: 'v1',
              plate: 'BCDF12',
              latitude: Number.NaN,
              longitude: Number.NaN,
              speedKmh: null,
            },
            { id: 'v2', plate: 'AAAA11', latitude: -33.46, longitude: -70.64, speedKmh: 10 },
          ]}
        />,
      );
      expect(screen.getAllByTestId('marker')).toHaveLength(1);
    });

    it('marker seleccionado usa color más oscuro (Pin background)', () => {
      render(
        <FleetMap
          selectedId="v1"
          vehicles={[
            { id: 'v1', plate: 'BCDF12', latitude: -33.45, longitude: -70.65 },
            { id: 'v2', plate: 'AAAA11', latitude: -33.46, longitude: -70.64 },
          ]}
        />,
      );
      const pins = screen.getAllByTestId('pin');
      const selectedPin = pins.find((p) => p.getAttribute('data-bg') === '#0D6E3F');
      const unselectedPin = pins.find((p) => p.getAttribute('data-bg') === '#1FA058');
      expect(selectedPin).toBeTruthy();
      expect(unselectedPin).toBeTruthy();
    });
  });

  describe('interactivity', () => {
    beforeEach(() => {
      envState.value = { VITE_GOOGLE_MAPS_API_KEY: 'test-key' };
    });

    it('onSelectVehicle se llama con el id al clickear marker', async () => {
      const onSelect = vi.fn();
      render(
        <FleetMap
          onSelectVehicle={onSelect}
          vehicles={[{ id: 'v-abc', plate: 'BCDF12', latitude: -33.45, longitude: -70.65 }]}
        />,
      );
      await userEvent.click(screen.getByTestId('marker'));
      expect(onSelect).toHaveBeenCalledWith('v-abc');
    });

    it('sin onSelectVehicle el click es noop (no crashea)', async () => {
      render(
        <FleetMap
          vehicles={[{ id: 'v-abc', plate: 'BCDF12', latitude: -33.45, longitude: -70.65 }]}
        />,
      );
      await userEvent.click(screen.getByTestId('marker'));
      // no throw
      expect(screen.getByTestId('marker')).toBeInTheDocument();
    });

    it('height prop aplica al style del Map', () => {
      render(<FleetMap vehicles={[]} height={600} />);
      const map = screen.getByTestId('google-map');
      expect(map).toHaveStyle({ height: '600px' });
    });
  });
});
