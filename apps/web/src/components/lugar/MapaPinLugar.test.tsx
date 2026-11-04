import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

const mapState: {
  libs: Record<string, unknown>;
  click: ((event: { detail: { latLng: { lat: number; lng: number } | null } }) => void) | undefined;
} = { libs: {}, click: undefined };

vi.mock('@vis.gl/react-google-maps', () => ({
  Map: ({
    children,
    onClick,
  }: {
    children: ReactNode;
    onClick?: (event: { detail: { latLng: { lat: number; lng: number } | null } }) => void;
  }) => {
    mapState.click = onClick;
    return <div data-testid="google-map">{children}</div>;
  },
  AdvancedMarker: ({
    children,
    onDragEnd,
  }: {
    children: ReactNode;
    onDragEnd?: (event: { latLng: { lat: () => number; lng: () => number } | null }) => void;
  }) => (
    <button
      type="button"
      data-testid="marker"
      onClick={() => onDragEnd?.({ latLng: { lat: () => -36.82, lng: () => -73.05 } })}
    >
      {children}
    </button>
  ),
  Pin: () => <span data-testid="pin" />,
  useMap: () => null,
  useMapsLibrary: (name: string) => mapState.libs[name] ?? null,
}));

const { MapaPinLugar } = await import('./MapaPinLugar.js');

describe('MapaPinLugar', () => {
  it('tocar el mapa mueve el pin', () => {
    const onMover = vi.fn();
    render(
      <MapaPinLugar
        latitude={null}
        longitude={null}
        revision={0}
        onMover={onMover}
        onLugar={vi.fn()}
        onGeocodeFallo={vi.fn()}
      />,
    );
    expect(screen.getByTestId('google-map')).toBeInTheDocument();
    mapState.click?.({ detail: { latLng: { lat: -33.45, lng: -70.66 } } });
    expect(onMover).toHaveBeenCalledWith(-33.45, -70.66);
  });

  it('soltar el pin arrastrado entrega las coordenadas', () => {
    const onMover = vi.fn();
    render(
      <MapaPinLugar
        latitude={-33.45}
        longitude={-70.66}
        revision={1}
        onMover={onMover}
        onLugar={vi.fn()}
        onGeocodeFallo={vi.fn()}
      />,
    );
    screen.getByTestId('marker').click();
    expect(onMover).toHaveBeenCalledWith(-36.82, -73.05);
  });
});
