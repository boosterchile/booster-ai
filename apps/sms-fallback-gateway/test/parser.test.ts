import { describe, expect, it } from 'vitest';
import { parseSmsFallback } from '../src/parser.js';

describe('parseSmsFallback — Wave 2 Track B4', () => {
  describe('mensaje válido', () => {
    it('parsea Crash event', () => {
      const r = parseSmsFallback(
        'BSTR|356307042441013|20260506T142530|-33.456900,-70.648300|65|1|247',
      );
      expect(r.ok).toBe(true);
      if (!r.ok) {
        return;
      }
      expect(r.payload).toEqual({
        imei: '356307042441013',
        timestampMs: Date.UTC(2026, 4, 6, 14, 25, 30),
        latitude: -33.4569,
        longitude: -70.6483,
        speedKmh: 65,
        rawValue: 1,
        avlId: 247,
      });
    });

    it('parsea Unplug event', () => {
      const r = parseSmsFallback(
        'BSTR|356307042441013|20260506T100000|-33.000000,-70.000000|0|1|252',
      );
      expect(r.ok).toBe(true);
      if (!r.ok) {
        return;
      }
      expect(r.payload.avlId).toBe(252);
      expect(r.payload.speedKmh).toBe(0);
    });

    it('parsea GNSS Jamming critical (val=2)', () => {
      const r = parseSmsFallback(
        'BSTR|356307042441013|20260506T100000|-33.000000,-70.000000|45|2|318',
      );
      expect(r.ok).toBe(true);
      if (!r.ok) {
        return;
      }
      expect(r.payload.avlId).toBe(318);
      expect(r.payload.rawValue).toBe(2);
    });

    it('trim leading/trailing whitespace', () => {
      const r = parseSmsFallback(
        '   BSTR|356307042441013|20260506T100000|-33.000000,-70.000000|0|1|247   ',
      );
      expect(r.ok).toBe(true);
    });
  });

  describe('errores de formato', () => {
    it('missing magic prefix → missing_magic', () => {
      const r = parseSmsFallback('hello world');
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error).toBe('missing_magic');
      }
    });

    it('field count incorrecto → wrong_field_count', () => {
      const r = parseSmsFallback('BSTR|123|20260506T100000|-33.0,-70.0|0|1');
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error).toBe('wrong_field_count');
      }
    });

    it('imei muy corto → invalid_imei', () => {
      const r = parseSmsFallback('BSTR|123|20260506T100000|-33.000000,-70.000000|0|1|247');
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error).toBe('invalid_imei');
      }
    });

    it('imei con letras → invalid_imei', () => {
      const r = parseSmsFallback(
        'BSTR|abcdef0123456|20260506T100000|-33.000000,-70.000000|0|1|247',
      );
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error).toBe('invalid_imei');
      }
    });

    it('datetime malformado → invalid_datetime', () => {
      const r = parseSmsFallback('BSTR|356307042441013|2026-05-06T14:25:30|-33.0,-70.0|0|1|247');
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error).toBe('invalid_datetime');
      }
    });

    it('datetime con día inexistente (20260230) → invalid_datetime', () => {
      const r = parseSmsFallback(
        'BSTR|356307042441013|20260230T100000|-33.000000,-70.000000|0|1|247',
      );
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error).toBe('invalid_datetime');
      }
    });

    it('coords sin coma → invalid_coords', () => {
      const r = parseSmsFallback(
        'BSTR|356307042441013|20260506T100000|-33.000000-70.000000|0|1|247',
      );
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error).toBe('invalid_coords');
      }
    });

    it('lat fuera de rango (>90) → invalid_coords', () => {
      const r = parseSmsFallback('BSTR|356307042441013|20260506T100000|95.0,0.0|0|1|247');
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error).toBe('invalid_coords');
      }
    });

    it('lng fuera de rango (>180) → invalid_coords', () => {
      const r = parseSmsFallback('BSTR|356307042441013|20260506T100000|0.0,200.0|0|1|247');
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error).toBe('invalid_coords');
      }
    });

    it('speed negativo → invalid_speed', () => {
      const r = parseSmsFallback('BSTR|356307042441013|20260506T100000|-33.0,-70.0|-10|1|247');
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error).toBe('invalid_speed');
      }
    });

    it('speed > 500 km/h → invalid_speed', () => {
      const r = parseSmsFallback('BSTR|356307042441013|20260506T100000|-33.0,-70.0|600|1|247');
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error).toBe('invalid_speed');
      }
    });

    it('AVL ID no aceptado (ej. 24) → invalid_avl_id', () => {
      // Solo 247/252/318 son válidos para SMS fallback (Panic events).
      const r = parseSmsFallback('BSTR|356307042441013|20260506T100000|-33.0,-70.0|0|1|24');
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error).toBe('invalid_avl_id');
      }
    });

    it('AVL ID no numérico → invalid_avl_id', () => {
      const r = parseSmsFallback('BSTR|356307042441013|20260506T100000|-33.0,-70.0|0|1|abc');
      expect(r.ok).toBe(false);
    });
  });
});
