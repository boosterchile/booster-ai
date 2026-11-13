import { describe, expect, it } from 'vitest';
import { claseMasChicaElegible } from '../src/elegibilidad/clase-mas-chica.js';
import type { TipoDeCarga } from '../src/elegibilidad/tabla.js';

/**
 * matching-desde-la-carga §3.12: sin vehículo declarado, la estimación usa
 * la clase más chica del catálogo por defecto por capacidad. La carrocería
 * no cambia la clase de emisión: refrigerado/tanque solo cuando la carga lo
 * exige; si ninguna genérica alcanza → camion_pesado.
 */
describe('claseMasChicaElegible', () => {
  it('carga_seca liviana → camioneta (menor capacidad genérica)', () => {
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

  it('carga_seca sobre 28 t → camion_pesado (no tanque)', () => {
    expect(
      claseMasChicaElegible({ cargoType: 'carga_seca', weightKg: 29_000, volumeM3: null }),
    ).toBe('camion_pesado');
  });

  it('refrigerada/congelada exigen refrigerado', () => {
    expect(
      claseMasChicaElegible({ cargoType: 'refrigerada', weightKg: 2_000, volumeM3: null }),
    ).toBe('refrigerado');
    expect(
      claseMasChicaElegible({ cargoType: 'congelada', weightKg: 10_000, volumeM3: null }),
    ).toBe('refrigerado');
  });

  it('refrigerada sobre capacidad del refrigerado → camion_pesado', () => {
    expect(
      claseMasChicaElegible({ cargoType: 'refrigerada', weightKg: 20_000, volumeM3: null }),
    ).toBe('camion_pesado');
  });

  it('liquida exige cisterna → tanque', () => {
    expect(claseMasChicaElegible({ cargoType: 'liquida', weightKg: 5_000, volumeM3: null })).toBe(
      'tanque',
    );
  });

  it('sin peso declarado elige la más chica genérica (o especializada si exige)', () => {
    expect(claseMasChicaElegible({ cargoType: 'otra', weightKg: null, volumeM3: null })).toBe(
      'camioneta',
    );
    expect(claseMasChicaElegible({ cargoType: 'perecible', weightKg: null, volumeM3: null })).toBe(
      'camioneta',
    );
    expect(claseMasChicaElegible({ cargoType: 'liquida', weightKg: null, volumeM3: null })).toBe(
      'tanque',
    );
  });

  it('ganado (solo jaula, fuera del catálogo) escala por capacidad genérica', () => {
    expect(claseMasChicaElegible({ cargoType: 'ganado', weightKg: 1_000, volumeM3: null })).toBe(
      'camioneta',
    );
    expect(claseMasChicaElegible({ cargoType: 'ganado', weightKg: 29_000, volumeM3: null })).toBe(
      'camion_pesado',
    );
  });

  /**
   * Matriz del hallazgo de revisión: genéricas por capacidad; especializadas
   * solo si la carga lo exige; tope → camion_pesado (nunca tanque por fallback).
   */
  it.each([
    ['carga_seca', 500, 'camioneta'],
    ['carga_seca', 3_000, 'furgon_mediano'],
    ['carga_seca', 4_500, 'camion_pequeno'],
    ['carga_seca', 10_000, 'camion_mediano'],
    ['carga_seca', 20_000, 'camion_pesado'],
    ['carga_seca', 29_000, 'camion_pesado'],
    ['perecible', 500, 'camioneta'],
    ['perecible', 3_000, 'furgon_mediano'],
    ['perecible', 4_500, 'camion_pequeno'],
    ['perecible', 10_000, 'camion_mediano'],
    ['perecible', 20_000, 'camion_pesado'],
    ['perecible', 29_000, 'camion_pesado'],
    ['fragil', 500, 'camioneta'],
    ['fragil', 3_000, 'furgon_mediano'],
    ['fragil', 4_500, 'camion_pequeno'],
    ['fragil', 5_000, 'camion_pequeno'],
    ['fragil', 10_000, 'camion_mediano'],
    ['fragil', 20_000, 'camion_pesado'],
    ['agricola', 4_500, 'camion_pequeno'],
    ['agricola', 20_000, 'camion_pesado'],
    ['construccion', 500, 'camioneta'],
    ['construccion', 3_000, 'furgon_mediano'],
    ['construccion', 4_500, 'camion_pequeno'],
    ['construccion', 10_000, 'camion_mediano'],
    ['construccion', 20_000, 'camion_pesado'],
    ['construccion', 29_000, 'camion_pesado'],
    ['peligrosa', 4_500, 'camion_pequeno'],
    ['peligrosa', 10_000, 'camion_mediano'],
    ['liquida', 500, 'tanque'],
    ['liquida', 3_000, 'tanque'],
    ['liquida', 10_000, 'tanque'],
    ['liquida', 29_000, 'tanque'],
    ['liquida', 31_000, 'camion_pesado'],
    ['ganado', 500, 'camioneta'],
    ['ganado', 4_500, 'camion_pequeno'],
    ['ganado', 20_000, 'camion_pesado'],
    ['refrigerada', 500, 'refrigerado'],
    ['refrigerada', 10_000, 'refrigerado'],
    ['refrigerada', 20_000, 'camion_pesado'],
    ['congelada', 2_000, 'refrigerado'],
  ] as const satisfies ReadonlyArray<readonly [TipoDeCarga, number, string]>)(
    '%s %skg → %s',
    (cargoType, weightKg, esperado) => {
      expect(claseMasChicaElegible({ cargoType, weightKg, volumeM3: null })).toBe(esperado);
    },
  );
});
