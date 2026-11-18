import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DiffCambio, valorLegible } from './DiffCambio.js';

describe('DiffCambio', () => {
  it('muestra cada campo propuesto con su valor anterior, en orden', () => {
    render(
      <DiffCambio
        cambios={{ proposed_price_clp: 900_000, weight_kg: 2500 }}
        anteriores={{ proposed_price_clp: 800_000, weight_kg: 1000 }}
      />,
    );
    const filas = screen.getAllByRole('row').slice(1);
    expect(filas.map((f) => within(f).getByRole('rowheader').textContent)).toEqual([
      'Peso',
      'Precio del transportista',
    ]);
    expect(within(filas[0] as HTMLElement).getByText('1.000 kg')).toBeInTheDocument();
    expect(within(filas[0] as HTMLElement).getByText('2.500 kg')).toBeInTheDocument();
    expect(within(filas[1] as HTMLElement).getByText('$900.000')).toBeInTheDocument();
  });
});

describe('valorLegible', () => {
  it.each([
    [
      'origin',
      { address_raw: 'Av. Uno 1', region_code: 'XIII' },
      'Av. Uno 1 (XIII — Metropolitana)',
    ],
    // Un cambio solo de comuna tiene que leerse distinto del valor anterior.
    [
      'origin',
      { address_raw: 'Av. Uno 1', region_code: 'XIII', comuna_code: '13114' },
      'Av. Uno 1 (Las Condes, XIII — Metropolitana)',
    ],
    ['cargo_type', 'refrigerada', 'Refrigerada'],
    ['modalidad_carga', 'programada', 'Programada'],
    ['description', null, 'Sin dato'],
    ['volume_m3', 12, '12 m³'],
  ] as const)('%s → %s', (campo, valor, esperado) => {
    expect(valorLegible(campo, valor as never)).toBe(esperado);
  });

  it('la ventana se muestra en hora de Santiago', () => {
    expect(
      valorLegible('pickup_window', {
        start_at: '2026-11-20T12:00:00.000Z',
        end_at: '2026-11-20T15:00:00.000Z',
      }),
    ).toMatch(/\b9:00.*→.*12:00/);
  });
});
