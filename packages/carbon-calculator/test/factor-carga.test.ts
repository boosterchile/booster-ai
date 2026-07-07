import { describe, expect, it } from 'vitest';
import {
  calcularFactorCorreccionPorCarga,
  categoriaPorConfiguracion,
  categoriaVehiculo,
} from '../src/glec/factor-carga.js';

describe('calcularFactorCorreccionPorCarga — GLEC v3.0 §6.3', () => {
  it('default (sin categoría): α=0.10 (MDV) — comportamiento legacy', () => {
    const r = calcularFactorCorreccionPorCarga({ cargaKg: 25000, capacidadKg: 25000 });
    // ratio=1, α=0.10 → 1 + 0.10 × (1 − 0.5) = 1.05
    expect(r).toBeCloseTo(1.05, 3);
  });

  it('LDV α=0.05: efecto carga atenuado', () => {
    const lleno = calcularFactorCorreccionPorCarga({
      cargaKg: 1000,
      capacidadKg: 1000,
      categoria: 'LDV',
    });
    // 1 + 0.05 × 0.5 = 1.025
    expect(lleno).toBeCloseTo(1.025, 3);
    const vacio = calcularFactorCorreccionPorCarga({
      cargaKg: 0,
      capacidadKg: 1000,
      categoria: 'LDV',
    });
    // 1 + 0.05 × (-0.5) = 0.975
    expect(vacio).toBeCloseTo(0.975, 3);
  });

  it('MDV α=0.10', () => {
    const lleno = calcularFactorCorreccionPorCarga({
      cargaKg: 5000,
      capacidadKg: 5000,
      categoria: 'MDV',
    });
    expect(lleno).toBeCloseTo(1.05, 3);
  });

  it('HDV α=0.15: efecto carga máximo (camión grande)', () => {
    const lleno = calcularFactorCorreccionPorCarga({
      cargaKg: 28000,
      capacidadKg: 28000,
      categoria: 'HDV',
    });
    // 1 + 0.15 × 0.5 = 1.075
    expect(lleno).toBeCloseTo(1.075, 3);
    const vacio = calcularFactorCorreccionPorCarga({
      cargaKg: 0,
      capacidadKg: 28000,
      categoria: 'HDV',
    });
    // 1 + 0.15 × (-0.5) = 0.925
    expect(vacio).toBeCloseTo(0.925, 3);
  });

  it('override directo de α gana sobre la categoría', () => {
    const r = calcularFactorCorreccionPorCarga({
      cargaKg: 5000,
      capacidadKg: 5000,
      categoria: 'HDV',
      alfa: 0.05, // override LDV-style
    });
    // 1 + 0.05 × 0.5 = 1.025 (no usa el HDV α=0.15)
    expect(r).toBeCloseTo(1.025, 3);
  });

  it('capacidad <=0 retorna 1 (sin corrección)', () => {
    expect(calcularFactorCorreccionPorCarga({ cargaKg: 5000, capacidadKg: 0 })).toBe(1);
    expect(calcularFactorCorreccionPorCarga({ cargaKg: 5000, capacidadKg: -100 })).toBe(1);
  });

  it('sobrecarga >150% se cap a 1.5 ratio', () => {
    const r = calcularFactorCorreccionPorCarga({
      cargaKg: 50000, // 200% capacidad
      capacidadKg: 25000,
      categoria: 'HDV',
    });
    // ratio capeado a 1.5 → 1 + 0.15 × (1.5 − 0.5) = 1.15
    expect(r).toBeCloseTo(1.15, 3);
  });
});

describe('categoriaVehiculo — mapping a GLEC §6.3', () => {
  it('LDV: camionetas y furgones pequeños', () => {
    expect(categoriaVehiculo('camioneta')).toBe('LDV');
    expect(categoriaVehiculo('furgon_pequeno')).toBe('LDV');
  });

  it('MDV: furgon mediano y camion pequeno', () => {
    expect(categoriaVehiculo('furgon_mediano')).toBe('MDV');
    expect(categoriaVehiculo('camion_pequeno')).toBe('MDV');
  });

  it('HDV: camion mediano/pesado, semi, refrigerado, tanque', () => {
    expect(categoriaVehiculo('camion_mediano')).toBe('HDV');
    expect(categoriaVehiculo('camion_pesado')).toBe('HDV');
    expect(categoriaVehiculo('semi_remolque')).toBe('HDV');
    expect(categoriaVehiculo('refrigerado')).toBe('HDV');
    expect(categoriaVehiculo('tanque')).toBe('HDV');
  });

  // W4a (ADR-073) — tipos nuevos de tipo_unidad (tracto_camion,
  // semirremolque, remolque) agregados al switch para clasificación. Los 9
  // valores legacy de arriba NO cambian de comportamiento (compat legacy).
  it('HDV: tipos nuevos de tipo_unidad (tracto_camion, semirremolque, remolque)', () => {
    expect(categoriaVehiculo('tracto_camion')).toBe('HDV');
    expect(categoriaVehiculo('semirremolque')).toBe('HDV');
    expect(categoriaVehiculo('remolque')).toBe('HDV');
  });
});

describe('categoriaPorConfiguracion — clase GLEC derivada de la CONFIGURACIÓN de viaje (D4, W4a)', () => {
  // A diferencia de categoriaVehiculo() (lookup por tipo de vehículo suelto),
  // esta función clasifica la CONFIGURACIÓN efectiva del servicio
  // (motriz + 0..1 arrastre, decisiones.md D1): con arrastre enganchado, la
  // configuración es articulada → siempre HDV, independiente del peso.
  // Motriz sola → por GVW agregado (curbWeightKg + capacityKg).
  //
  // Cortes GVW (referencial, ver docs/adr/073 §Fuentes normativas — el
  // corte MDV≤16t no está tomado literalmente de una tabla publicada de
  // GLEC v3.0 ni de D.S. N°158/1980 MOP; es una convención de ingeniería
  // del proyecto, coherente con la segmentación LDV/MDV/HDV que ya usa
  // categoriaVehiculo()).
  it('tracto + semi → HDV (articulado, independiente del peso agregado)', () => {
    const categoria = categoriaPorConfiguracion({
      motriz: { tipoUnidad: 'tracto_camion', curbWeightKg: 7000, capacityKg: 0 },
      arrastre: { tipoUnidad: 'semirremolque', curbWeightKg: 7000, capacityKg: 30000 },
    });
    expect(categoria).toBe('HDV');
  });

  it('rígido solo, GVW=12t → MDV', () => {
    const categoria = categoriaPorConfiguracion({
      motriz: { tipoUnidad: 'camion_rigido', curbWeightKg: 4000, capacityKg: 8000 },
    });
    expect(categoria).toBe('MDV');
  });

  it('rígido + remolque → HDV (articulado, aunque el rígido solo sería MDV)', () => {
    const categoria = categoriaPorConfiguracion({
      motriz: { tipoUnidad: 'camion_rigido', curbWeightKg: 4000, capacityKg: 8000 },
      arrastre: { tipoUnidad: 'remolque', curbWeightKg: 3000, capacityKg: 15000 },
    });
    expect(categoria).toBe('HDV');
  });

  it('camioneta motriz sola, GVW < 3.5t → LDV', () => {
    const categoria = categoriaPorConfiguracion({
      motriz: { tipoUnidad: 'camioneta', curbWeightKg: 2000, capacityKg: 1000 },
    });
    expect(categoria).toBe('LDV');
  });

  it('borde GVW=3.5t exacto → MDV (LDV es estrictamente < 3.5t)', () => {
    const categoria = categoriaPorConfiguracion({
      motriz: { tipoUnidad: 'furgon', curbWeightKg: 2500, capacityKg: 1000 },
    });
    expect(categoria).toBe('MDV');
  });

  it('borde justo bajo 3.5t → LDV', () => {
    const categoria = categoriaPorConfiguracion({
      motriz: { tipoUnidad: 'furgon', curbWeightKg: 2499, capacityKg: 1000 },
    });
    expect(categoria).toBe('LDV');
  });

  it('borde GVW=16t exacto → MDV (HDV es estrictamente > 16t)', () => {
    const categoria = categoriaPorConfiguracion({
      motriz: { tipoUnidad: 'camion_rigido', curbWeightKg: 6000, capacityKg: 10000 },
    });
    expect(categoria).toBe('MDV');
  });

  it('borde justo sobre 16t → HDV', () => {
    const categoria = categoriaPorConfiguracion({
      motriz: { tipoUnidad: 'camion_rigido', curbWeightKg: 6000, capacityKg: 10001 },
    });
    expect(categoria).toBe('HDV');
  });
});
