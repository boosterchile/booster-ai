import { describe, expect, it } from 'vitest';
import { calcularExactoCanbus } from '../src/modos/exacto-canbus.js';

describe('calcularExactoCanbus — telemetría real', () => {
  it('usa el consumo real medido sin corrección por carga', () => {
    const r = calcularExactoCanbus({
      metodo: 'exacto_canbus',
      distanciaKm: 350,
      combustibleConsumido: 105, // L medidos por CAN-BUS
      cargaKg: 12000,
      vehiculo: {
        combustible: 'diesel',
        consumoBasePor100km: 28, // declarado, ignorado en este modo
        pesoVacioKg: 8000,
        capacidadKg: 25000,
      },
    });

    expect(r.combustibleConsumido).toBe(105);
    expect(r.emisionesKgco2eWtw).toBeCloseTo(105 * 3.77, 1);
    expect(r.metodoPrecision).toBe('exacto_canbus');
  });

  it('intensidad correcta con datos reales', () => {
    const r = calcularExactoCanbus({
      metodo: 'exacto_canbus',
      distanciaKm: 100,
      combustibleConsumido: 30,
      cargaKg: 10000,
      vehiculo: {
        combustible: 'diesel',
        consumoBasePor100km: 28,
        pesoVacioKg: 8000,
        capacidadKg: 25000,
      },
    });
    // emisiones: 30 × 3.77 = 113.1 kg
    // intensidad: 113100 / (100 × 10) = 113.1 g/(t·km)
    expect(r.intensidadGco2ePorTonKm).toBeCloseTo(113.1, 0);
  });

  it('rechaza valores negativos', () => {
    const veh = {
      combustible: 'diesel' as const,
      consumoBasePor100km: 28,
      pesoVacioKg: 8000,
      capacidadKg: 25000,
    };
    expect(() =>
      calcularExactoCanbus({
        metodo: 'exacto_canbus',
        distanciaKm: -1,
        combustibleConsumido: 10,
        cargaKg: 0,
        vehiculo: veh,
      }),
    ).toThrow();
  });
});
