import { describe, expect, it } from 'vitest';
import { AVL_ID_DALLAS, interpretDallasTemperature } from '../../src/avl-ids/index.js';

describe('interpretDallasTemperature — Wave 3 catálogo Dallas Temperature (IOs 72-75 FMC150)', () => {
  describe('IO 72 (Dallas Temperature 1) — raw', () => {
    it('raw positivo (décimas de °C) → Celsius', () => {
      // 55 décimas = 5.5°C
      const r = interpretDallasTemperature([
        { id: AVL_ID_DALLAS.DALLAS_TEMPERATURE_1, value: 55, byteSize: 2 },
      ]);
      expect(r.telemetry.dallasTemperature1C).toBeCloseTo(5.5, 5);
      expect(r.unknownEntries).toEqual([]);
      expect(r.invalidEntries).toEqual([]);
    });

    it("raw negativo (two's complement uint16) → Celsius negativo", () => {
      // -20.0°C = -200 décimas → uint16 = 0x10000 - 200 = 65336 (0xFF38)
      const r = interpretDallasTemperature([
        { id: AVL_ID_DALLAS.DALLAS_TEMPERATURE_1, value: 0xff38, byteSize: 2 },
      ]);
      expect(r.telemetry.dallasTemperature1C).toBeCloseTo(-20, 5);
    });

    it('raw 0 → 0.0°C', () => {
      const r = interpretDallasTemperature([
        { id: AVL_ID_DALLAS.DALLAS_TEMPERATURE_1, value: 0, byteSize: 2 },
      ]);
      expect(r.telemetry.dallasTemperature1C).toBe(0);
    });

    it('fuera de rango físico DS18B20 (> 125°C) → invalidEntries, sin dato en telemetry', () => {
      // 130.0°C = 1300 décimas — imposible para un DS18B20, sensor desconectado/corrupto.
      const r = interpretDallasTemperature([
        { id: AVL_ID_DALLAS.DALLAS_TEMPERATURE_1, value: 1300, byteSize: 2 },
      ]);
      expect(r.telemetry.dallasTemperature1C).toBeUndefined();
      expect(r.invalidEntries).toHaveLength(1);
      expect(r.invalidEntries[0]?.id).toBe(AVL_ID_DALLAS.DALLAS_TEMPERATURE_1);
    });

    it('fuera de rango físico DS18B20 (< -55°C) → invalidEntries', () => {
      // -60.0°C = -600 décimas → uint16 = 0x10000 - 600 = 64936
      const r = interpretDallasTemperature([
        { id: AVL_ID_DALLAS.DALLAS_TEMPERATURE_1, value: 0x10000 - 600, byteSize: 2 },
      ]);
      expect(r.telemetry.dallasTemperature1C).toBeUndefined();
      expect(r.invalidEntries).toHaveLength(1);
    });

    it('sentinel Teltonika conocido 0x8000 (sensor desconectado, -3276.8°C) → invalidEntries', () => {
      const r = interpretDallasTemperature([
        { id: AVL_ID_DALLAS.DALLAS_TEMPERATURE_1, value: 0x8000, byteSize: 2 },
      ]);
      expect(r.telemetry.dallasTemperature1C).toBeUndefined();
      expect(r.invalidEntries).toHaveLength(1);
    });

    it('boundary: exactamente -55°C (límite inferior DS18B20) es válido', () => {
      // -55.0°C = -550 décimas → uint16 = 0x10000 - 550 = 64986
      const r = interpretDallasTemperature([
        { id: AVL_ID_DALLAS.DALLAS_TEMPERATURE_1, value: 0x10000 - 550, byteSize: 2 },
      ]);
      expect(r.telemetry.dallasTemperature1C).toBeCloseTo(-55, 5);
      expect(r.invalidEntries).toEqual([]);
    });

    it('boundary: exactamente 125°C (límite superior DS18B20) es válido', () => {
      const r = interpretDallasTemperature([
        { id: AVL_ID_DALLAS.DALLAS_TEMPERATURE_1, value: 1250, byteSize: 2 },
      ]);
      expect(r.telemetry.dallasTemperature1C).toBeCloseTo(125, 5);
      expect(r.invalidEntries).toEqual([]);
    });

    it('value bigint (no aplica al parser N2) cae a invalid (NaN)', () => {
      const r = interpretDallasTemperature([
        { id: AVL_ID_DALLAS.DALLAS_TEMPERATURE_1, value: 100n, byteSize: 2 },
      ]);
      expect(r.invalidEntries).toHaveLength(1);
      expect(r.telemetry.dallasTemperature1C).toBeUndefined();
    });
  });

  describe('IOs 73-75 (Dallas Temperature 2-4)', () => {
    it('interpreta los 4 sensores en un mismo record', () => {
      const r = interpretDallasTemperature([
        { id: AVL_ID_DALLAS.DALLAS_TEMPERATURE_1, value: 55, byteSize: 2 },
        { id: AVL_ID_DALLAS.DALLAS_TEMPERATURE_2, value: 80, byteSize: 2 },
        { id: AVL_ID_DALLAS.DALLAS_TEMPERATURE_3, value: 90, byteSize: 2 },
        { id: AVL_ID_DALLAS.DALLAS_TEMPERATURE_4, value: 100, byteSize: 2 },
      ]);
      expect(r.telemetry.dallasTemperature1C).toBeCloseTo(5.5, 5);
      expect(r.telemetry.dallasTemperature2C).toBeCloseTo(8.0, 5);
      expect(r.telemetry.dallasTemperature3C).toBeCloseTo(9.0, 5);
      expect(r.telemetry.dallasTemperature4C).toBeCloseTo(10.0, 5);
      expect(r.unknownEntries).toEqual([]);
      expect(r.invalidEntries).toEqual([]);
    });
  });

  describe('ausente e IDs desconocidos', () => {
    it('entries vacío (ausente) → telemetry vacío sin errores', () => {
      const r = interpretDallasTemperature([]);
      expect(r.telemetry).toEqual({});
      expect(r.unknownEntries).toEqual([]);
      expect(r.invalidEntries).toEqual([]);
    });

    it('ID fuera del catálogo Dallas (ej. 999) reportado como unknown, no aborta', () => {
      const r = interpretDallasTemperature([
        { id: 999, value: 42, byteSize: 1 },
        { id: AVL_ID_DALLAS.DALLAS_TEMPERATURE_1, value: 55, byteSize: 2 },
      ]);
      expect(r.unknownEntries).toEqual([{ id: 999, value: 42 }]);
      expect(r.telemetry.dallasTemperature1C).toBeCloseTo(5.5, 5);
    });
  });
});
