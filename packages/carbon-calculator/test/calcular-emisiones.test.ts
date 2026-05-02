import { describe, expect, it } from 'vitest';
import { calcularEmisionesViaje } from '../src/calcular-emisiones.js';

describe('calcularEmisionesViaje — entry point unificado', () => {
  it('despacha correctamente a modo modelado', () => {
    const r = calcularEmisionesViaje({
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
    expect(r.metodoPrecision).toBe('modelado');
  });

  it('despacha correctamente a modo exacto_canbus', () => {
    const r = calcularEmisionesViaje({
      metodo: 'exacto_canbus',
      distanciaKm: 100,
      combustibleConsumido: 28,
      cargaKg: 5000,
      vehiculo: {
        combustible: 'diesel',
        consumoBasePor100km: 28,
        pesoVacioKg: 8000,
        capacidadKg: 25000,
      },
    });
    expect(r.metodoPrecision).toBe('exacto_canbus');
  });

  it('despacha correctamente a modo por_defecto', () => {
    const r = calcularEmisionesViaje({
      metodo: 'por_defecto',
      distanciaKm: 100,
      cargaKg: 5000,
      tipoVehiculo: 'camion_mediano',
    });
    expect(r.metodoPrecision).toBe('por_defecto');
  });
});
