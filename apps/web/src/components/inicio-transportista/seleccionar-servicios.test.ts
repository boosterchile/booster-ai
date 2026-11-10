import { describe, expect, it } from 'vitest';
import { seleccionarServicios } from './use-datos-inicio.js';

const fila = (id: string, status: string) =>
  ({
    id,
    status,
    driver: null,
    vehicle: null,
    trip: {
      pickup_window_start: null,
      origin: { address_raw: 'A' },
      destination: { address_raw: 'B' },
    },
  }) as never;

describe('seleccionarServicios', () => {
  it('el Inicio muestra solo lo que está en curso, sin las canceladas', () => {
    expect(
      seleccionarServicios([fila('a1', 'asignado'), fila('a2', 'cancelado')]).map((s) => s.id),
    ).toEqual(['a1']);
  });
});
