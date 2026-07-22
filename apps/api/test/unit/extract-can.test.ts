import { describe, expect, it } from 'vitest';
import { extractCan } from '../../src/routes/vehiculos.js';

/**
 * Fixtures reales de PLFL57 (imei 860693084796730) — recon telemetría.
 * `io_data` es el jsonb `{String(id): value}` tal cual lo persiste el
 * processor. El CAN (81/84/85/89 + resto LVCAN) solo aparece con el motor
 * encendido; los pings de vehículo apagado traen solo I/O permanente.
 */

/** Ping con CAN (motor encendido, 20-jul 20:31): incluye LVCAN 81-90. */
const PLFL57_CAN_IODATA = {
  '1': 0,
  '16': 972232,
  '17': 65419,
  '21': 5,
  '24': 0,
  '66': 28317,
  '67': 4055,
  '68': 0,
  '69': 1,
  '72': 0,
  '80': 4,
  '81': 0, // vehicle speed CAN → 0 km/h
  '82': 0,
  '83': 641055,
  '84': 520, // fuel level → 52.0 L (no se expone en vivo)
  '85': 852, // engine RPM
  '87': 714996340,
  '89': 26, // fuel level %
  '90': 0,
  '239': 0,
  '240': 0,
  '241': 73001,
};

/** Ping SIN CAN (motor apagado, 21-jul): solo I/O permanente, sin 81-90. */
const PLFL57_NO_CAN_IODATA = {
  '1': 0,
  '16': 972232,
  '17': 65393,
  '21': 5,
  '24': 0,
  '66': 25200,
  '67': 4054,
  '68': 0,
  '69': 1,
  '72': 0,
  '80': 4,
  '239': 0,
  '240': 0,
  '241': 73001,
};

describe('extractCan — CAN LVCAN v1 (81 speed, 85 RPM, 89 fuel %) para /vehiculos/:id/ubicacion', () => {
  it('ping con CAN (motor encendido) → los 3 campos v1 escalados', () => {
    const r = extractCan(PLFL57_CAN_IODATA);
    expect(r.can_speed_kmh).toBe(0); // AVL 81
    expect(r.rpm).toBe(852); // AVL 85
    expect(r.fuel_pct).toBe(26); // AVL 89
  });

  it('ping SIN CAN (motor apagado) → todos null, no rompe', () => {
    expect(extractCan(PLFL57_NO_CAN_IODATA)).toEqual({
      can_speed_kmh: null,
      rpm: null,
      fuel_pct: null,
    });
  });

  it('io_data vacío → todos null', () => {
    expect(extractCan({})).toEqual({ can_speed_kmh: null, rpm: null, fuel_pct: null });
  });

  it('io_data no-objeto (boundary Zod) → todos null, no tira', () => {
    expect(extractCan(null)).toEqual({ can_speed_kmh: null, rpm: null, fuel_pct: null });
    expect(extractCan('garbage')).toEqual({ can_speed_kmh: null, rpm: null, fuel_pct: null });
    expect(extractCan(42)).toEqual({ can_speed_kmh: null, rpm: null, fuel_pct: null });
  });

  it('RAW CAN inválido (fuel% imposible > 100) → ese campo null, el resto vive', () => {
    const r = extractCan({ '85': 852, '89': 200 });
    expect(r.rpm).toBe(852);
    expect(r.fuel_pct).toBeNull();
  });

  it('v1 expone SOLO 3 campos — fuel L (84), fuel consumed (83) y mileage (87) NO salen en vivo', () => {
    expect(Object.keys(extractCan(PLFL57_CAN_IODATA)).sort()).toEqual([
      'can_speed_kmh',
      'fuel_pct',
      'rpm',
    ]);
  });
});
