import { describe, expect, it } from 'vitest';
import {
  AVL_ID,
  AVL_ID_EVENT,
  CHANNEL_TO_PUBSUB_TOPIC,
  routeEvent,
} from '../../src/avl-ids/index.js';

describe('routeEvent — Wave 2 Track B2', () => {
  describe('cada uno de los 10 AVL IDs eventuales rutea al channel correcto', () => {
    it('AVL 247 (Crash) → safety-p0 panic', () => {
      const r = routeEvent([{ id: AVL_ID_EVENT.CRASH, value: 1, byteSize: 1 }]);
      expect(r.events).toEqual([
        {
          channel: 'safety-p0',
          priority: 'panic',
          avlId: 247,
          eventName: 'Crash',
          rawValue: 1,
        },
      ]);
      expect(r.invalidEvents).toEqual([]);
    });

    it('AVL 252 (Unplug) → safety-p0 panic', () => {
      const r = routeEvent([{ id: AVL_ID_EVENT.UNPLUG, value: 1, byteSize: 1 }]);
      expect(r.events[0]?.channel).toBe('safety-p0');
      expect(r.events[0]?.priority).toBe('panic');
      expect(r.events[0]?.eventName).toBe('Unplug');
    });

    it('AVL 318 (GNSS Jamming) → safety-p0 panic, valor critical=2', () => {
      const r = routeEvent([{ id: AVL_ID_EVENT.GNSS_JAMMING, value: 2, byteSize: 1 }]);
      expect(r.events[0]?.channel).toBe('safety-p0');
      expect(r.events[0]?.rawValue).toBe(2);
    });

    it('AVL 318 (GNSS Jamming) acepta los 3 valores 0/1/2', () => {
      for (const v of [0, 1, 2]) {
        const r = routeEvent([{ id: AVL_ID_EVENT.GNSS_JAMMING, value: v, byteSize: 1 }]);
        expect(r.events).toHaveLength(1);
        expect(r.events[0]?.rawValue).toBe(v);
      }
    });

    it('AVL 246 (Towing) → security-p1 high', () => {
      const r = routeEvent([{ id: AVL_ID_EVENT.TOWING, value: 1, byteSize: 1 }]);
      expect(r.events[0]?.channel).toBe('security-p1');
      expect(r.events[0]?.priority).toBe('high');
    });

    it('AVL 175 (Auto Geofence) → security-p1 high, valor exited=1', () => {
      const r = routeEvent([{ id: AVL_ID_EVENT.AUTO_GEOFENCE, value: 1, byteSize: 1 }]);
      expect(r.events[0]?.channel).toBe('security-p1');
      expect(r.events[0]?.rawValue).toBe(1);
    });

    it('AVL 251 (Excessive Idling) → eco-score, ambos 0/1', () => {
      for (const v of [0, 1]) {
        const r = routeEvent([{ id: AVL_ID_EVENT.EXCESSIVE_IDLING, value: v, byteSize: 1 }]);
        expect(r.events[0]?.channel).toBe('eco-score');
        expect(r.events[0]?.rawValue).toBe(v);
      }
    });

    it('AVL 253 (Green Driving) → eco-score, valores 1/2/3', () => {
      for (const v of [1, 2, 3]) {
        const r = routeEvent([{ id: AVL_ID_EVENT.GREEN_DRIVING, value: v, byteSize: 1 }]);
        expect(r.events[0]?.channel).toBe('eco-score');
        expect(r.events[0]?.rawValue).toBe(v);
      }
    });

    it('AVL 255 (Over Speeding) → eco-score, ambos 0/1', () => {
      for (const v of [0, 1]) {
        const r = routeEvent([{ id: AVL_ID_EVENT.OVER_SPEEDING, value: v, byteSize: 1 }]);
        expect(r.events[0]?.channel).toBe('eco-score');
        expect(r.events[0]?.rawValue).toBe(v);
      }
    });

    it('AVL 250 (Trip) → trip-transitions, ambos 0/1', () => {
      for (const v of [0, 1]) {
        const r = routeEvent([{ id: AVL_ID_EVENT.TRIP, value: v, byteSize: 1 }]);
        expect(r.events[0]?.channel).toBe('trip-transitions');
        expect(r.events[0]?.rawValue).toBe(v);
      }
    });

    it('AVL 155 (Geofence Zone) → trip-transitions, ambos 0/1', () => {
      for (const v of [0, 1]) {
        const r = routeEvent([{ id: AVL_ID_EVENT.GEOFENCE_ZONE, value: v, byteSize: 1 }]);
        expect(r.events[0]?.channel).toBe('trip-transitions');
      }
    });
  });

  describe('múltiples eventos en un solo record', () => {
    it('Crash + GNSS Jamming critical genera 2 eventos en safety-p0', () => {
      const r = routeEvent([
        { id: AVL_ID_EVENT.CRASH, value: 1, byteSize: 1 },
        { id: AVL_ID_EVENT.GNSS_JAMMING, value: 2, byteSize: 1 },
      ]);
      expect(r.events).toHaveLength(2);
      expect(r.events[0]?.eventName).toBe('Crash');
      expect(r.events[1]?.eventName).toBe('GnssJamming');
      expect(r.events.every((e) => e.channel === 'safety-p0')).toBe(true);
    });

    it('preserva el orden de los eventos según orden de aparición', () => {
      const r = routeEvent([
        { id: AVL_ID_EVENT.GREEN_DRIVING, value: 1, byteSize: 1 },
        { id: AVL_ID_EVENT.OVER_SPEEDING, value: 1, byteSize: 1 },
        { id: AVL_ID_EVENT.GREEN_DRIVING, value: 2, byteSize: 1 },
      ]);
      expect(r.events.map((e) => e.eventName)).toEqual([
        'GreenDriving',
        'OverSpeeding',
        'GreenDriving',
      ]);
      expect(r.events.map((e) => e.rawValue)).toEqual([1, 1, 2]);
    });
  });

  describe('AVL IDs Low Priority y desconocidos NO generan eventos', () => {
    it('AVL 24 (Speed, Low Priority) en el record es ignorado por router', () => {
      const r = routeEvent([
        { id: AVL_ID.SPEED, value: 80, byteSize: 2 },
        { id: AVL_ID.IGNITION, value: 1, byteSize: 1 },
      ]);
      expect(r.events).toEqual([]);
      expect(r.invalidEvents).toEqual([]);
    });

    it('IDs totalmente desconocidos son ignorados silenciosamente', () => {
      const r = routeEvent([{ id: 9999, value: 1, byteSize: 1 }]);
      expect(r.events).toEqual([]);
      expect(r.invalidEvents).toEqual([]);
    });

    it('mezcla Low Priority + eventual: solo el eventual genera evento', () => {
      const r = routeEvent([
        { id: AVL_ID.SPEED, value: 100, byteSize: 2 }, // ignorado
        { id: AVL_ID_EVENT.CRASH, value: 1, byteSize: 1 }, // evento
        { id: AVL_ID.IGNITION, value: 1, byteSize: 1 }, // ignorado
      ]);
      expect(r.events).toHaveLength(1);
      expect(r.events[0]?.eventName).toBe('Crash');
    });
  });

  describe('invalidEvents — RAW fuera del schema', () => {
    it('Crash con value 0 (debe ser exactamente 1) → invalid', () => {
      const r = routeEvent([{ id: AVL_ID_EVENT.CRASH, value: 0, byteSize: 1 }]);
      expect(r.events).toEqual([]);
      expect(r.invalidEvents).toHaveLength(1);
      expect(r.invalidEvents[0]?.id).toBe(247);
    });

    it('GNSS Jamming = 3 (fuera de 0..2) → invalid', () => {
      const r = routeEvent([{ id: AVL_ID_EVENT.GNSS_JAMMING, value: 3, byteSize: 1 }]);
      expect(r.events).toEqual([]);
      expect(r.invalidEvents).toHaveLength(1);
    });

    it('Green Driving = 0 (debe ser 1/2/3) → invalid', () => {
      const r = routeEvent([{ id: AVL_ID_EVENT.GREEN_DRIVING, value: 0, byteSize: 1 }]);
      expect(r.invalidEvents).toHaveLength(1);
    });

    it('campo malo NO aborta el resto: Crash inválido + Unplug válido', () => {
      const r = routeEvent([
        { id: AVL_ID_EVENT.CRASH, value: 0, byteSize: 1 }, // inválido
        { id: AVL_ID_EVENT.UNPLUG, value: 1, byteSize: 1 }, // válido
      ]);
      expect(r.events).toHaveLength(1);
      expect(r.events[0]?.eventName).toBe('Unplug');
      expect(r.invalidEvents).toHaveLength(1);
    });
  });

  describe('edge cases', () => {
    it('entries vacío → events y invalidEvents vacíos', () => {
      const r = routeEvent([]);
      expect(r.events).toEqual([]);
      expect(r.invalidEvents).toEqual([]);
    });
  });

  describe('CHANNEL_TO_PUBSUB_TOPIC mapping', () => {
    it('los 4 channels tienen topic Pub/Sub correspondiente', () => {
      expect(CHANNEL_TO_PUBSUB_TOPIC).toEqual({
        'safety-p0': 'telemetry-events-safety-p0',
        'security-p1': 'telemetry-events-security-p1',
        'eco-score': 'telemetry-events-eco-score',
        'trip-transitions': 'telemetry-events-trip-transitions',
      });
    });
  });
});
