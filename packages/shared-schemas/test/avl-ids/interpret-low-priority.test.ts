import { describe, expect, it } from 'vitest';
import { AVL_ID, interpretLowPriority } from '../../src/avl-ids/index.js';

describe('interpretLowPriority — Wave 2 Track B1', () => {
  describe('cada uno de los 14 IDs', () => {
    it('AVL 239 (Ignition) — bool: 1 → true', () => {
      const r = interpretLowPriority([{ id: AVL_ID.IGNITION, value: 1, byteSize: 1 }]);
      expect(r.telemetry.ignition).toBe(true);
      expect(r.unknownEntries).toEqual([]);
      expect(r.invalidEntries).toEqual([]);
    });

    it('AVL 239 (Ignition) — bool: 0 → false', () => {
      const r = interpretLowPriority([{ id: AVL_ID.IGNITION, value: 0, byteSize: 1 }]);
      expect(r.telemetry.ignition).toBe(false);
    });

    it('AVL 240 (Movement) — bool: 1 → true', () => {
      const r = interpretLowPriority([{ id: AVL_ID.MOVEMENT, value: 1, byteSize: 1 }]);
      expect(r.telemetry.movement).toBe(true);
    });

    it('AVL 200 (Sleep Mode) — enum 0..4', () => {
      for (let v = 0; v <= 4; v++) {
        const r = interpretLowPriority([{ id: AVL_ID.SLEEP_MODE, value: v, byteSize: 1 }]);
        expect(r.telemetry.sleepMode).toBe(v);
      }
    });

    it('AVL 21 (GSM Signal) — bars 0..5', () => {
      for (let v = 0; v <= 5; v++) {
        const r = interpretLowPriority([{ id: AVL_ID.GSM_SIGNAL, value: v, byteSize: 1 }]);
        expect(r.telemetry.gsmSignalBars).toBe(v);
      }
    });

    it('AVL 69 (GNSS Status) — enum 0..4', () => {
      const r = interpretLowPriority([{ id: AVL_ID.GNSS_STATUS, value: 1, byteSize: 1 }]);
      expect(r.telemetry.gnssStatus).toBe(1);
    });

    it('AVL 181 (GNSS PDOP) — uint16 ×10 → decimal /10', () => {
      const r = interpretLowPriority([{ id: AVL_ID.GNSS_PDOP, value: 28, byteSize: 2 }]);
      expect(r.telemetry.gnssPdop).toBeCloseTo(2.8, 5);
    });

    it('AVL 181 (GNSS PDOP) — RAW 0 → 0.0', () => {
      const r = interpretLowPriority([{ id: AVL_ID.GNSS_PDOP, value: 0, byteSize: 2 }]);
      expect(r.telemetry.gnssPdop).toBe(0);
    });

    it('AVL 182 (GNSS HDOP) — divide /10', () => {
      const r = interpretLowPriority([{ id: AVL_ID.GNSS_HDOP, value: 15, byteSize: 2 }]);
      expect(r.telemetry.gnssHdop).toBeCloseTo(1.5, 5);
    });

    it('AVL 66 (External Voltage) — uint16 mV preservado', () => {
      const r = interpretLowPriority([{ id: AVL_ID.EXTERNAL_VOLTAGE, value: 12500, byteSize: 2 }]);
      expect(r.telemetry.externalVoltageMv).toBe(12500);
    });

    it('AVL 66 (External Voltage) = 0 (unplug detectado) sigue siendo válido', () => {
      const r = interpretLowPriority([{ id: AVL_ID.EXTERNAL_VOLTAGE, value: 0, byteSize: 2 }]);
      expect(r.telemetry.externalVoltageMv).toBe(0);
    });

    it('AVL 67 (Battery Voltage) — uint16 mV preservado', () => {
      const r = interpretLowPriority([{ id: AVL_ID.BATTERY_VOLTAGE, value: 4100, byteSize: 2 }]);
      expect(r.telemetry.batteryVoltageMv).toBe(4100);
    });

    it('AVL 68 (Battery Current) — int16 SIGNED, negativo (descarga)', () => {
      // 0xFFEC = uint16 65516 → int16 -20 (descarga)
      const r = interpretLowPriority([{ id: AVL_ID.BATTERY_CURRENT, value: 0xffec, byteSize: 2 }]);
      expect(r.telemetry.batteryCurrentMa).toBe(-20);
    });

    it('AVL 68 (Battery Current) — int16 positivo (carga)', () => {
      const r = interpretLowPriority([{ id: AVL_ID.BATTERY_CURRENT, value: 150, byteSize: 2 }]);
      expect(r.telemetry.batteryCurrentMa).toBe(150);
    });

    it('AVL 68 (Battery Current) — boundary uint16 0x7FFF = +32767', () => {
      const r = interpretLowPriority([{ id: AVL_ID.BATTERY_CURRENT, value: 0x7fff, byteSize: 2 }]);
      expect(r.telemetry.batteryCurrentMa).toBe(32767);
    });

    it('AVL 68 (Battery Current) — boundary uint16 0x8000 = -32768', () => {
      const r = interpretLowPriority([{ id: AVL_ID.BATTERY_CURRENT, value: 0x8000, byteSize: 2 }]);
      expect(r.telemetry.batteryCurrentMa).toBe(-32768);
    });

    it('AVL 24 (Speed) — uint16 km/h preservado', () => {
      const r = interpretLowPriority([{ id: AVL_ID.SPEED, value: 80, byteSize: 2 }]);
      expect(r.telemetry.speedKmh).toBe(80);
    });

    it('AVL 16 (Total Odometer) — uint32 metros preservado', () => {
      const r = interpretLowPriority([
        { id: AVL_ID.TOTAL_ODOMETER, value: 145_678_000, byteSize: 4 },
      ]);
      expect(r.telemetry.totalOdometerM).toBe(145_678_000);
    });

    it('AVL 199 (Trip Odometer) — uint32 metros preservado', () => {
      const r = interpretLowPriority([{ id: AVL_ID.TRIP_ODOMETER, value: 12_500, byteSize: 4 }]);
      expect(r.telemetry.tripOdometerM).toBe(12_500);
    });

    it('AVL 80 (Data Mode) — enum 0..5', () => {
      for (let v = 0; v <= 5; v++) {
        const r = interpretLowPriority([{ id: AVL_ID.DATA_MODE, value: v, byteSize: 1 }]);
        expect(r.telemetry.dataMode).toBe(v);
      }
    });
  });

  describe('unknownEntries — IDs fuera del catálogo Low Priority', () => {
    it('reporta IDs desconocidos sin abortar', () => {
      const r = interpretLowPriority([
        { id: 999, value: 42, byteSize: 1 },
        { id: AVL_ID.IGNITION, value: 1, byteSize: 1 },
      ]);
      expect(r.telemetry.ignition).toBe(true);
      expect(r.unknownEntries).toEqual([{ id: 999, value: 42 }]);
      expect(r.invalidEntries).toEqual([]);
    });

    it('múltiples desconocidos se reportan en orden', () => {
      const r = interpretLowPriority([
        { id: 1, value: 100, byteSize: 1 },
        { id: 2, value: 200, byteSize: 2 },
      ]);
      expect(r.unknownEntries).toEqual([
        { id: 1, value: 100 },
        { id: 2, value: 200 },
      ]);
    });

    it('preserva tipo de value en unknown (number/bigint/buffer)', () => {
      const buf = Buffer.from([0xab, 0xcd]);
      const r = interpretLowPriority([
        { id: 500, value: 42n, byteSize: 8 },
        { id: 501, value: buf, byteSize: null },
      ]);
      expect(r.unknownEntries).toEqual([
        { id: 500, value: 42n },
        { id: 501, value: buf },
      ]);
    });
  });

  describe('invalidEntries — RAW fuera del schema', () => {
    it('Sleep Mode = 7 (fuera de 0..4) reportado como invalid', () => {
      const r = interpretLowPriority([{ id: AVL_ID.SLEEP_MODE, value: 7, byteSize: 1 }]);
      expect(r.telemetry.sleepMode).toBeUndefined();
      expect(r.invalidEntries).toHaveLength(1);
      expect(r.invalidEntries[0]?.id).toBe(AVL_ID.SLEEP_MODE);
      expect(r.invalidEntries[0]?.value).toBe(7);
    });

    it('GSM Signal = 8 (fuera de 0..5) reportado como invalid', () => {
      const r = interpretLowPriority([{ id: AVL_ID.GSM_SIGNAL, value: 8, byteSize: 1 }]);
      expect(r.telemetry.gsmSignalBars).toBeUndefined();
      expect(r.invalidEntries).toHaveLength(1);
    });

    it('External Voltage negativo (raw inválido) reportado', () => {
      const r = interpretLowPriority([{ id: AVL_ID.EXTERNAL_VOLTAGE, value: -1, byteSize: 2 }]);
      expect(r.telemetry.externalVoltageMv).toBeUndefined();
      expect(r.invalidEntries).toHaveLength(1);
    });

    it('Ignition = 2 (no es 0/1) reportado como invalid', () => {
      const r = interpretLowPriority([{ id: AVL_ID.IGNITION, value: 2, byteSize: 1 }]);
      expect(r.telemetry.ignition).toBeUndefined();
      expect(r.invalidEntries).toHaveLength(1);
    });

    it('Battery Current con value bigint (no aplica) cae a invalid (NaN)', () => {
      const r = interpretLowPriority([{ id: AVL_ID.BATTERY_CURRENT, value: 100n, byteSize: 2 }]);
      expect(r.invalidEntries).toHaveLength(1);
    });

    it('campo malo NO aborta el resto: Speed=80 sigue válido aunque Sleep sea inválido', () => {
      const r = interpretLowPriority([
        { id: AVL_ID.SLEEP_MODE, value: 99, byteSize: 1 },
        { id: AVL_ID.SPEED, value: 80, byteSize: 2 },
      ]);
      expect(r.telemetry.speedKmh).toBe(80);
      expect(r.telemetry.sleepMode).toBeUndefined();
      expect(r.invalidEntries).toHaveLength(1);
    });
  });

  describe('integración — múltiples IDs en un solo record', () => {
    it('parsea un record realista con 6 IDs', () => {
      // Snapshot típico de un FMC150 reportando ignición ON, en movimiento,
      // velocidad 65 km/h, GPS bueno, voltaje normal, sin sleep.
      const r = interpretLowPriority([
        { id: AVL_ID.IGNITION, value: 1, byteSize: 1 },
        { id: AVL_ID.MOVEMENT, value: 1, byteSize: 1 },
        { id: AVL_ID.SPEED, value: 65, byteSize: 2 },
        { id: AVL_ID.GNSS_PDOP, value: 18, byteSize: 2 },
        { id: AVL_ID.GNSS_HDOP, value: 12, byteSize: 2 },
        { id: AVL_ID.EXTERNAL_VOLTAGE, value: 12500, byteSize: 2 },
      ]);
      expect(r.telemetry).toEqual({
        ignition: true,
        movement: true,
        speedKmh: 65,
        gnssPdop: 1.8,
        gnssHdop: 1.2,
        externalVoltageMv: 12500,
      });
      expect(r.unknownEntries).toEqual([]);
      expect(r.invalidEntries).toEqual([]);
    });

    it('mezcla IDs conocidos, desconocidos e inválidos en una sola llamada', () => {
      const r = interpretLowPriority([
        { id: AVL_ID.IGNITION, value: 1, byteSize: 1 }, // válido
        { id: 999, value: 42, byteSize: 1 }, // desconocido
        { id: AVL_ID.SLEEP_MODE, value: 99, byteSize: 1 }, // inválido
        { id: AVL_ID.SPEED, value: 100, byteSize: 2 }, // válido
      ]);
      expect(r.telemetry).toEqual({ ignition: true, speedKmh: 100 });
      expect(r.unknownEntries).toEqual([{ id: 999, value: 42 }]);
      expect(r.invalidEntries).toHaveLength(1);
    });

    it('entries vacío → telemetry vacío sin errores', () => {
      const r = interpretLowPriority([]);
      expect(r.telemetry).toEqual({});
      expect(r.unknownEntries).toEqual([]);
      expect(r.invalidEntries).toEqual([]);
    });
  });
});
