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
    // factorWtw diesel = 2.70 + 0.55 = 3.25 (GLEC v3.0 + IPCC AR6 GWP-100)
    expect(r.emisionesKgco2eWtw).toBeCloseTo(105 * 3.25, 1);
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
    // emisiones: 30 × 3.25 = 97.5 kg
    // intensidad: 97500 / (100 × 10) = 97.5 g/(t·km)
    expect(r.intensidadGco2ePorTonKm).toBeCloseTo(97.5, 0);
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
