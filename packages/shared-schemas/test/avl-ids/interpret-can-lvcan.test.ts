import { describe, expect, it } from 'vitest';
import { AVL_ID_CAN, interpretCanLvcan } from '../../src/avl-ids/index.js';

/**
 * Catálogo CAN LVCAN v1 (IDs 81/84/85/89 del adaptador CAN Teltonika,
 * confirmados en PLFL57). Escalas: 81 km/h directo, 84 fuel level ×0.1 L,
 * 85 RPM directo, 89 fuel level %.
 */
describe('interpretCanLvcan — catálogo CAN LVCAN v1 (81/84/85/89)', () => {
  describe('escalas por ID', () => {
    it('81 vehicle speed → km/h directo', () => {
      const r = interpretCanLvcan([{ id: AVL_ID_CAN.CAN_VEHICLE_SPEED, value: 90, byteSize: 2 }]);
      expect(r.telemetry.vehicleSpeedKmh).toBe(90);
      expect(r.unknownEntries).toEqual([]);
      expect(r.invalidEntries).toEqual([]);
    });

    it('84 fuel level → litros (raw ×0.1): 520 → 52.0 L', () => {
      const r = interpretCanLvcan([{ id: AVL_ID_CAN.CAN_FUEL_LEVEL_L, value: 520, byteSize: 2 }]);
      expect(r.telemetry.fuelLevelL).toBeCloseTo(52.0, 5);
    });

    it('85 engine RPM → directo', () => {
      const r = interpretCanLvcan([{ id: AVL_ID_CAN.CAN_ENGINE_RPM, value: 852, byteSize: 2 }]);
      expect(r.telemetry.engineRpm).toBe(852);
    });

    it('89 fuel level → % directo', () => {
      const r = interpretCanLvcan([{ id: AVL_ID_CAN.CAN_FUEL_LEVEL_PCT, value: 26, byteSize: 1 }]);
      expect(r.telemetry.fuelLevelPct).toBe(26);
    });

    it('raw 0 → 0 (no null): un valor real de vehículo detenido con motor on', () => {
      const r = interpretCanLvcan([{ id: AVL_ID_CAN.CAN_VEHICLE_SPEED, value: 0, byteSize: 2 }]);
      expect(r.telemetry.vehicleSpeedKmh).toBe(0);
    });
  });

  describe('record real de PLFL57 (motor encendido) — los 4 IDs juntos', () => {
    it('interpreta 81/84/85/89 de un ping CAN real', () => {
      const r = interpretCanLvcan([
        { id: 81, value: 0, byteSize: 2 },
        { id: 84, value: 520, byteSize: 2 },
        { id: 85, value: 852, byteSize: 2 },
        { id: 89, value: 26, byteSize: 1 },
      ]);
      expect(r.telemetry.vehicleSpeedKmh).toBe(0);
      expect(r.telemetry.fuelLevelL).toBeCloseTo(52.0, 5);
      expect(r.telemetry.engineRpm).toBe(852);
      expect(r.telemetry.fuelLevelPct).toBe(26);
      expect(r.unknownEntries).toEqual([]);
      expect(r.invalidEntries).toEqual([]);
    });
  });

  describe('boundaries y RAW inválido', () => {
    it('fuel % > 100 (imposible) → invalidEntries, sin dato', () => {
      const r = interpretCanLvcan([{ id: AVL_ID_CAN.CAN_FUEL_LEVEL_PCT, value: 200, byteSize: 1 }]);
      expect(r.telemetry.fuelLevelPct).toBeUndefined();
      expect(r.invalidEntries).toHaveLength(1);
      expect(r.invalidEntries[0]?.id).toBe(AVL_ID_CAN.CAN_FUEL_LEVEL_PCT);
    });

    it('fuel % exactamente 100 (límite) es válido', () => {
      const r = interpretCanLvcan([{ id: AVL_ID_CAN.CAN_FUEL_LEVEL_PCT, value: 100, byteSize: 1 }]);
      expect(r.telemetry.fuelLevelPct).toBe(100);
      expect(r.invalidEntries).toEqual([]);
    });

    it('velocidad absurda (> 300 km/h) → invalidEntries', () => {
      const r = interpretCanLvcan([{ id: AVL_ID_CAN.CAN_VEHICLE_SPEED, value: 9999, byteSize: 2 }]);
      expect(r.telemetry.vehicleSpeedKmh).toBeUndefined();
      expect(r.invalidEntries).toHaveLength(1);
    });

    it('RPM absurdo (> 20000) → invalidEntries', () => {
      const r = interpretCanLvcan([{ id: AVL_ID_CAN.CAN_ENGINE_RPM, value: 60000, byteSize: 2 }]);
      expect(r.telemetry.engineRpm).toBeUndefined();
      expect(r.invalidEntries).toHaveLength(1);
    });

    it('value bigint no aplica → invalid (NaN), no rompe', () => {
      const r = interpretCanLvcan([{ id: AVL_ID_CAN.CAN_ENGINE_RPM, value: 852n, byteSize: 8 }]);
      expect(r.telemetry.engineRpm).toBeUndefined();
      expect(r.invalidEntries).toHaveLength(1);
    });
  });

  describe('ausente e IDs desconocidos (motor apagado / no-CAN)', () => {
    it('entries vacío → telemetry vacío, sin errores', () => {
      const r = interpretCanLvcan([]);
      expect(r.telemetry).toEqual({});
      expect(r.unknownEntries).toEqual([]);
      expect(r.invalidEntries).toEqual([]);
    });

    it('solo IDs no-CAN (ej. GPS/GSM 16/66/239) → unknown, no aborta', () => {
      const r = interpretCanLvcan([
        { id: 16, value: 972232, byteSize: 4 },
        { id: 66, value: 25200, byteSize: 2 },
        { id: 239, value: 0, byteSize: 1 },
      ]);
      expect(r.telemetry).toEqual({});
      expect(r.unknownEntries).toHaveLength(3);
    });
  });
});
