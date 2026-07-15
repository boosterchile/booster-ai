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

/** Mapa fake mínimo para ejercitar AutoFitBounds (spies sobre la API usada). */
interface FakeMap {
  setCenter: ReturnType<typeof vi.fn>;
  setZoom: ReturnType<typeof vi.fn>;
  fitBounds: ReturnType<typeof vi.fn>;
}

/**
 * Stub construible de google.maps.LatLngBounds. En la API real el
 * constructor vive en la librería 'core' (CoreLibrary) — NO en 'maps'
 * (outage /app/flota 2026-07-15) — y el mock respeta esa forma.
 */
class FakeLatLngBounds {
  extended: Array<{ lat: number; lng: number }> = [];
  extend(pos: { lat: number; lng: number }): void {
    this.extended.push(pos);
  }
}

const mapState: { map: FakeMap | null; libs: Record<string, unknown> } = {
  map: null,
  libs: {},
};

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
  useMap: () => mapState.map,
  useMapsLibrary: (name: string) => mapState.libs[name] ?? null,
}));

const { FleetMap } = await import('./FleetMap.js');

beforeEach(() => {
  envState.value = {};
  mapState.map = null;
  mapState.libs = {};
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

  describe('auto-fit bounds (regresión outage /app/flota 2026-07-15)', () => {
    beforeEach(() => {
      envState.value = { VITE_GOOGLE_MAPS_API_KEY: 'test-key' };
      mapState.map = { setCenter: vi.fn(), setZoom: vi.fn(), fitBounds: vi.fn() };
      // Forma real de las librerías google.maps: LatLngBounds SOLO en 'core'.
      // 'maps' truthy pero sin LatLngBounds, como en runtime — pedirlo ahí
      // era el bug (TypeError: not a constructor).
      mapState.libs = {
        core: { LatLngBounds: FakeLatLngBounds },
        maps: { Map: class {} },
      };
    });

    it('con ≥2 vehículos no tira y encuadra vía fitBounds con bounds de core', () => {
      expect(() =>
        render(
          <FleetMap
            vehicles={[
              { id: 'v1', plate: 'BCDF12', latitude: -33.45, longitude: -70.65 },
              { id: 'v2', plate: 'AAAA11', latitude: -33.46, longitude: -70.64 },
            ]}
          />,
        ),
      ).not.toThrow();

      const fitBounds = mapState.map?.fitBounds;
      expect(fitBounds).toHaveBeenCalledTimes(1);
      const bounds = fitBounds?.mock.calls[0]?.[0] as FakeLatLngBounds;
      expect(bounds).toBeInstanceOf(FakeLatLngBounds);
      expect(bounds.extended).toEqual([
        { lat: -33.45, lng: -70.65 },
        { lat: -33.46, lng: -70.64 },
      ]);
      expect(fitBounds?.mock.calls[0]?.[1]).toBe(60);
    });
  });
});
