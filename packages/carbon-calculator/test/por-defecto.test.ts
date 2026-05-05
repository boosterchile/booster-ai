import { describe, expect, it } from 'vitest';
import { calcularModelado } from '../src/modos/modelado.js';
import { calcularPorDefecto } from '../src/modos/por-defecto.js';

describe('calcularPorDefecto — defaults por tipo de vehículo', () => {
  it('camion_pesado: usa default 35 L/100km diésel, capacidad 28 ton', () => {
    const r = calcularPorDefecto({
      metodo: 'por_defecto',
      distanciaKm: 100,
      cargaKg: 14000, // 50 % de capacidad → factor corrección ≈ 1
      tipoVehiculo: 'camion_pesado',
    });
    // Consumo ≈ 35 L total para 100 km (HDV α=0.15, ratio=0.5 → corrección 1.0)
    // Emisiones ≈ 35 × 3.25 = 113.75 kg CO2e (factor GLEC v3.0 + IPCC AR6)
    expect(r.combustibleConsumido).toBeCloseTo(35, 0);
    expect(r.emisionesKgco2eWtw).toBeCloseTo(113.75, 0);
    expect(r.metodoPrecision).toBe('por_defecto');
  });

  it('por_defecto debe ser CONSERVADOR vs perfil real declarado', () => {
    // Si un carrier declara consumo MENOR al default → su modelado real
    // debe dar emisiones MENORES que el por_defecto (premia transparencia).
    const porDefecto = calcularPorDefecto({
      metodo: 'por_defecto',
      distanciaKm: 100,
      cargaKg: 10000,
      tipoVehiculo: 'camion_mediano',
    });

    const declaradoMejor = calcularModelado({
      metodo: 'modelado',
      distanciaKm: 100,
      cargaKg: 10000,
      vehiculo: {
        combustible: 'diesel',
        consumoBasePor100km: 22, // < 25 default
        pesoVacioKg: 7000,
        capacidadKg: 12000,
      },
    });

    expect(declaradoMejor.emisionesKgco2eWtw).toBeLessThan(porDefecto.emisionesKgco2eWtw);
  });

  it('camioneta y semi_remolque tienen consumos plausibles distintos', () => {
    const camioneta = calcularPorDefecto({
      metodo: 'por_defecto',
      distanciaKm: 100,
      cargaKg: 500,
      tipoVehiculo: 'camioneta',
    });
    const semi = calcularPorDefecto({
      metodo: 'por_defecto',
      distanciaKm: 100,
      cargaKg: 500,
      tipoVehiculo: 'semi_remolque',
    });
    expect(camioneta.emisionesKgco2eWtw).toBeLessThan(semi.emisionesKgco2eWtw);
  });

  it('reporta fuente con prefijo "defaults para tipo:"', () => {
    const r = calcularPorDefecto({
      metodo: 'por_defecto',
      distanciaKm: 50,
      cargaKg: 1000,
      tipoVehiculo: 'furgon_mediano',
    });
    expect(r.fuenteFactores).toContain('defaults para tipo: furgon_mediano');
  });
});
