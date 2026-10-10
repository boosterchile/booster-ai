import { describe, expect, it } from 'vitest';
import {
  K_MIN_VEHICULOS,
  claseVehiculo,
  filtrarK,
  franjaHoraria,
  proyectarViaje,
} from './proyeccion.js';

const BASE = {
  viajeId: '00000000-0000-4000-8000-000000000001',
  vehiculoId: '00000000-0000-4000-8000-000000000002',
  origenRegion: 'IV',
  origenComuna: '04102',
  destinoRegion: 'IV',
  destinoComuna: null,
  // 2026-10-07 (miércoles) 10:30 en Chile (UTC-3).
  recogidoEn: new Date('2026-10-07T13:30:00Z'),
  entregadoEn: new Date('2026-10-07T16:00:00Z'),
  tipoVehiculo: 'camion_pesado',
  distanciaKm: '42.50',
  kgco2eReales: '35.120',
  kgco2eEstimadas: '40.000',
  kgco2eEvitado: '12.300',
};

describe('franjaHoraria (hora de Chile)', () => {
  it.each([
    ['2026-10-07T09:00:00Z', '06-09'], // 06:00 Chile
    ['2026-10-07T11:59:00Z', '06-09'], // 08:59
    ['2026-10-07T12:00:00Z', '09-12'],
    ['2026-10-07T15:00:00Z', '12-15'],
    ['2026-10-07T18:00:00Z', '15-18'],
    ['2026-10-07T21:00:00Z', '18-21'],
    ['2026-10-08T00:00:00Z', '21-06'], // 21:00
    ['2026-10-08T08:59:00Z', '21-06'], // 05:59
  ])('%s → %s', (iso, franja) => {
    expect(franjaHoraria(new Date(iso))).toBe(franja);
  });
});

describe('claseVehiculo', () => {
  it('camioneta y furgones son livianos; el resto, pesados', () => {
    for (const t of ['camioneta', 'furgon_pequeno', 'furgon_mediano']) {
      expect(claseVehiculo(t)).toBe('liviano');
    }
    for (const t of ['camion_pequeno', 'camion_pesado', 'semi_remolque', 'tanque', 'refrigerado']) {
      expect(claseVehiculo(t)).toBe('pesado');
    }
  });
});

describe('proyectarViaje', () => {
  it('fila de BigQuery con franja, tipo de día, mes y emisiones reales', () => {
    expect(proyectarViaje(BASE)).toEqual({
      viaje_id: BASE.viajeId,
      vehiculo_id: BASE.vehiculoId,
      origen_region: 'IV',
      origen_comuna: '04102',
      destino_region: 'IV',
      destino_comuna: 'sin_comuna',
      mes: '2026-10',
      tipo_dia: 'laboral',
      franja: '09-12',
      clase_vehiculo: 'pesado',
      recogido_en: '2026-10-07T13:30:00.000Z',
      entregado_en: '2026-10-07T16:00:00.000Z',
      distancia_km: 42.5,
      kgco2e: 35.12,
      kgco2e_evitado: 12.3,
    });
  });

  it('sin emisiones reales usa las estimadas; sin evitado, 0', () => {
    const fila = proyectarViaje({ ...BASE, kgco2eReales: null, kgco2eEvitado: null });
    expect(fila.kgco2e).toBe(40);
    expect(fila.kgco2e_evitado).toBe(0);
  });

  it('sin recogida usa la entrega para franja y mes; sábado y domingo son fin de semana', () => {
    // 2026-10-10 sábado 23:30 Chile = 2026-10-11T02:30Z.
    const fila = proyectarViaje({
      ...BASE,
      recogidoEn: null,
      entregadoEn: new Date('2026-10-11T02:30:00Z'),
    });
    expect(fila.franja).toBe('21-06');
    expect(fila.tipo_dia).toBe('fin_semana');
    expect(fila.mes).toBe('2026-10');
  });

  it('el mes es el de Chile, no el UTC (31-oct 22:00 Chile = 1-nov UTC)', () => {
    const fila = proyectarViaje({ ...BASE, recogidoEn: new Date('2026-11-01T01:00:00Z') });
    expect(fila.mes).toBe('2026-10');
  });

  it('región nula se agrupa como sin_region; emisiones nulas como 0', () => {
    const fila = proyectarViaje({
      ...BASE,
      origenRegion: null,
      kgco2eReales: null,
      kgco2eEstimadas: null,
      distanciaKm: null,
    });
    expect(fila.origen_region).toBe('sin_region');
    expect(fila.kgco2e).toBe(0);
    expect(fila.distancia_km).toBeNull();
  });
});

describe('filtrarK (ADR-012 §Privacidad)', () => {
  it('descarta buckets con menos de 10 vehículos y nunca deja pasar IDs', () => {
    expect(K_MIN_VEHICULOS).toBe(10);
    const filas = [
      { region: 'IV', vehiculos: 10, viajes: 30 },
      { region: 'IV', vehiculos: 9, viajes: 90 },
      { region: 'V', vehiculos: 25, viajes: 40, vehiculo_id: 'x' },
    ];
    expect(filtrarK(filas)).toEqual([
      { region: 'IV', vehiculos: 10, viajes: 30 },
      { region: 'V', vehiculos: 25, viajes: 40 },
    ]);
  });

  it('vehículos no numérico o ausente → se descarta (falla cerrado)', () => {
    expect(filtrarK([{ region: 'IV' }, { region: 'IV', vehiculos: '12' }])).toEqual([]);
  });
});
