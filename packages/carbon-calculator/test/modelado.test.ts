import { describe, expect, it } from 'vitest';
import { calcularModelado } from '../src/modos/modelado.js';

describe('calcularModelado — escenarios de referencia', () => {
  it('camión mediano diésel, 350 km, 12 ton de carga', () => {
    // Camión mediano típico: 28 L/100km a carga normal, capacidad 25 ton.
    const r = calcularModelado({
      metodo: 'modelado',
      distanciaKm: 350,
      cargaKg: 12000,
      vehiculo: {
        combustible: 'diesel',
        consumoBasePor100km: 28,
        pesoVacioKg: 8000,
        capacidadKg: 25000,
      },
    });

    // Carga 12000 / 25000 = 0.48 → casi carga normal, factor corrección ~0.998
    // Consumo total ≈ 28 × 0.998 × 3.5 ≈ 97.8 L
    // Emisiones WTW ≈ 97.8 × 3.77 ≈ 369 kg CO2e
    // Intensidad ≈ 369000 g / (350 km × 12 ton) ≈ 87.9 g/(t·km)
    expect(r.combustibleConsumido).toBeGreaterThan(95);
    expect(r.combustibleConsumido).toBeLessThan(100);
    expect(r.emisionesKgco2eWtw).toBeGreaterThan(360);
    expect(r.emisionesKgco2eWtw).toBeLessThan(380);
    expect(r.intensidadGco2ePorTonKm).toBeGreaterThan(80);
    expect(r.intensidadGco2ePorTonKm).toBeLessThan(95);
    expect(r.metodoPrecision).toBe('modelado');
    expect(r.unidadCombustible).toBe('L');
  });

  it('camión vacío (carga 0) consume menos que con carga', () => {
    const veh = {
      combustible: 'diesel' as const,
      consumoBasePor100km: 28,
      pesoVacioKg: 8000,
      capacidadKg: 25000,
    };
    const lleno = calcularModelado({
      metodo: 'modelado',
      distanciaKm: 100,
      cargaKg: 25000,
      vehiculo: veh,
    });
    const vacio = calcularModelado({
      metodo: 'modelado',
      distanciaKm: 100,
      cargaKg: 0,
      vehiculo: veh,
    });
    expect(vacio.emisionesKgco2eWtw).toBeLessThan(lleno.emisionesKgco2eWtw);
  });

  it('intensidad gco2e/ton-km es 0 cuando carga es 0', () => {
    const r = calcularModelado({
      metodo: 'modelado',
      distanciaKm: 100,
      cargaKg: 0,
      vehiculo: {
        combustible: 'diesel',
        consumoBasePor100km: 28,
        pesoVacioKg: 8000,
        capacidadKg: 25000,
      },
    });
    expect(r.intensidadGco2ePorTonKm).toBe(0);
  });

  it('rechaza vehículo sin consumoBasePor100km', () => {
    expect(() =>
      calcularModelado({
        metodo: 'modelado',
        distanciaKm: 100,
        cargaKg: 5000,
        vehiculo: {
          combustible: 'diesel',
          consumoBasePor100km: null,
          pesoVacioKg: null,
          capacidadKg: 5000,
        },
      }),
    ).toThrow(/consumoBasePor100km/);
  });

  it('rechaza distancia o carga negativa', () => {
    const veh = {
      combustible: 'diesel' as const,
      consumoBasePor100km: 28,
      pesoVacioKg: 8000,
      capacidadKg: 25000,
    };
    expect(() =>
      calcularModelado({ metodo: 'modelado', distanciaKm: -1, cargaKg: 0, vehiculo: veh }),
    ).toThrow();
    expect(() =>
      calcularModelado({ metodo: 'modelado', distanciaKm: 100, cargaKg: -1, vehiculo: veh }),
    ).toThrow();
  });

  it('distribuye correctamente WTW = TTW + WTT', () => {
    const r = calcularModelado({
      metodo: 'modelado',
      distanciaKm: 100,
      cargaKg: 5000,
      vehiculo: {
        combustible: 'diesel',
        consumoBasePor100km: 28,
        pesoVacioKg: 8000,
        capacidadKg: 25000,
      },
    });
    expect(r.emisionesKgco2eTtw + r.emisionesKgco2eWtt).toBeCloseTo(
      r.emisionesKgco2eWtw,
      1,
    );
  });

  it('preserva fuente y versión GLEC en el resultado', () => {
    const r = calcularModelado({
      metodo: 'modelado',
      distanciaKm: 50,
      cargaKg: 1000,
      vehiculo: {
        combustible: 'gasolina',
        consumoBasePor100km: 12,
        pesoVacioKg: 2000,
        capacidadKg: 1500,
      },
    });
    expect(r.versionGlec).toBe('v3.0');
    expect(r.fuenteFactores).toContain('SEC Chile 2024');
  });
});
