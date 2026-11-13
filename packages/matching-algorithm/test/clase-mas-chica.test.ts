import { describe, expect, it } from 'vitest';
import { claseMasChicaElegible } from '../src/elegibilidad/clase-mas-chica.js';

/**
 * matching-desde-la-carga §3.12: sin vehículo declarado, la estimación usa
 * la clase más chica del catálogo por defecto que cumple §3.3.
 */
describe('claseMasChicaElegible', () => {
  it('carga_seca liviana → camioneta (menor capacidad compatible)', () => {
    expect(claseMasChicaElegible({ cargoType: 'carga_seca', weightKg: 500, volumeM3: null })).toBe(
      'camioneta',
    );
  });

  it('carga_seca que supera camioneta → furgón o camión según peso', () => {
    expect(
      claseMasChicaElegible({ cargoType: 'carga_seca', weightKg: 1_200, volumeM3: null }),
    ).toBe('furgon_pequeno');
    expect(
      claseMasChicaElegible({ cargoType: 'carga_seca', weightKg: 8_000, volumeM3: null }),
    ).toBe('camion_mediano');
  });

  it('refrigerada exige carrocería refrigerado (no camion_mediano fijo)', () => {
    expect(
      claseMasChicaElegible({ cargoType: 'refrigerada', weightKg: 2_000, volumeM3: null }),
    ).toBe('refrigerado');
  });

  it('liquida exige cisterna → tanque', () => {
    expect(claseMasChicaElegible({ cargoType: 'liquida', weightKg: 5_000, volumeM3: null })).toBe(
      'tanque',
    );
  });

  it('sin peso declarado elige la más chica compatible por carrocería', () => {
    expect(claseMasChicaElegible({ cargoType: 'otra', weightKg: null, volumeM3: null })).toBe(
      'camioneta',
    );
    expect(claseMasChicaElegible({ cargoType: 'perecible', weightKg: null, volumeM3: null })).toBe(
      'furgon_pequeno',
    );
  });

  it('si ninguna clase cumple (p.ej. ganado) usa la de mayor capacidad', () => {
    expect(claseMasChicaElegible({ cargoType: 'ganado', weightKg: 1_000, volumeM3: null })).toBe(
      'tanque',
    );
  });
});
