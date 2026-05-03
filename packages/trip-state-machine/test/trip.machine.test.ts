import { describe, expect, it } from 'vitest';
import {
  InvalidTransitionError,
  type TripEvent,
  type TripStatus,
  assertTripTransition,
  canTripTransition,
  getNextTripStatus,
  getValidEventsForTripStatus,
  isTerminalTripStatus,
} from '../src/index.js';

describe('tripMachine — happy path completo', () => {
  it('camino canónico borrador → entregado', () => {
    let status: TripStatus = 'borrador';

    // borrador → esperando_match
    status = getNextTripStatus(status, { type: 'START_MATCHING' }) ?? status;
    expect(status).toBe('esperando_match');

    // esperando_match → emparejando
    status = getNextTripStatus(status, { type: 'START_MATCHING' }) ?? status;
    expect(status).toBe('emparejando');

    // emparejando → ofertas_enviadas
    status = getNextTripStatus(status, { type: 'OFFERS_SENT' }) ?? status;
    expect(status).toBe('ofertas_enviadas');

    // ofertas_enviadas → asignado
    status = getNextTripStatus(status, { type: 'OFFER_ACCEPTED' }) ?? status;
    expect(status).toBe('asignado');

    // asignado → en_proceso
    status = getNextTripStatus(status, { type: 'PICKUP_CONFIRMED' }) ?? status;
    expect(status).toBe('en_proceso');

    // en_proceso → entregado
    status = getNextTripStatus(status, { type: 'DELIVERY_CONFIRMED' }) ?? status;
    expect(status).toBe('entregado');

    expect(isTerminalTripStatus(status)).toBe(true);
  });
});

describe('tripMachine — caminos alternativos', () => {
  it('emparejando → esperando_match (NO_MATCH retry)', () => {
    expect(getNextTripStatus('emparejando', { type: 'NO_MATCH' })).toBe('esperando_match');
  });

  it('ofertas_enviadas → expirado (todas las ofertas vencieron)', () => {
    expect(getNextTripStatus('ofertas_enviadas', { type: 'ALL_OFFERS_EXPIRED' })).toBe('expirado');
  });

  it('expirado → esperando_match (RETRY)', () => {
    expect(getNextTripStatus('expirado', { type: 'RETRY' })).toBe('esperando_match');
  });
});

describe('tripMachine — cancelación desde estados activos', () => {
  const cancellableStates: TripStatus[] = [
    'borrador',
    'esperando_match',
    'emparejando',
    'ofertas_enviadas',
    'asignado',
    'en_proceso',
  ];

  for (const state of cancellableStates) {
    it(`${state} → cancelado (CANCEL permitido)`, () => {
      expect(getNextTripStatus(state, { type: 'CANCEL' })).toBe('cancelado');
    });
  }

  it('expirado NO acepta CANCEL (debe retry primero)', () => {
    expect(canTripTransition('expirado', { type: 'CANCEL' })).toBe(false);
  });
});

describe('tripMachine — terminales bloquean transiciones', () => {
  const allEvents: TripEvent[] = [
    { type: 'START_MATCHING' },
    { type: 'OFFERS_SENT' },
    { type: 'NO_MATCH' },
    { type: 'OFFER_ACCEPTED' },
    { type: 'ALL_OFFERS_EXPIRED' },
    { type: 'PICKUP_CONFIRMED' },
    { type: 'DELIVERY_CONFIRMED' },
    { type: 'CANCEL' },
    { type: 'RETRY' },
  ];

  for (const event of allEvents) {
    it(`entregado rechaza ${event.type}`, () => {
      expect(canTripTransition('entregado', event)).toBe(false);
    });

    it(`cancelado rechaza ${event.type}`, () => {
      expect(canTripTransition('cancelado', event)).toBe(false);
    });
  }

  it('isTerminalTripStatus identifica entregado y cancelado', () => {
    expect(isTerminalTripStatus('entregado')).toBe(true);
    expect(isTerminalTripStatus('cancelado')).toBe(true);
    expect(isTerminalTripStatus('en_proceso')).toBe(false);
    expect(isTerminalTripStatus('expirado')).toBe(false);
  });
});

describe('tripMachine — saltos ilegales bloqueados', () => {
  it('borrador NO puede saltar directo a entregado', () => {
    expect(canTripTransition('borrador', { type: 'DELIVERY_CONFIRMED' })).toBe(false);
  });

  it('ofertas_enviadas NO puede saltar a entregado sin pasar por asignado/en_proceso', () => {
    expect(canTripTransition('ofertas_enviadas', { type: 'DELIVERY_CONFIRMED' })).toBe(false);
  });

  it('asignado NO acepta DELIVERY_CONFIRMED (debe pasar por en_proceso)', () => {
    expect(canTripTransition('asignado', { type: 'DELIVERY_CONFIRMED' })).toBe(false);
  });

  it('en_proceso NO acepta OFFER_ACCEPTED (regresión a flujo viejo)', () => {
    expect(canTripTransition('en_proceso', { type: 'OFFER_ACCEPTED' })).toBe(false);
  });
});

describe('assertTripTransition — throws con info útil', () => {
  it('error message identifica entity, fromStatus y event', () => {
    expect(() => assertTripTransition('entregado', { type: 'CANCEL' })).toThrowError(
      InvalidTransitionError,
    );

    try {
      assertTripTransition('entregado', { type: 'CANCEL' });
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidTransitionError);
      const e = err as InvalidTransitionError;
      expect(e.entity).toBe('trip');
      expect(e.fromStatus).toBe('entregado');
      expect(e.event).toBe('CANCEL');
      expect(e.message).toContain("status='entregado'");
      expect(e.message).toContain("evento 'CANCEL'");
    }
  });

  it('no throwea para transición legal', () => {
    expect(() => assertTripTransition('borrador', { type: 'START_MATCHING' })).not.toThrow();
  });
});

describe('getValidEventsForTripStatus — UI gating', () => {
  it('borrador permite START_MATCHING + CANCEL', () => {
    expect(getValidEventsForTripStatus('borrador').sort()).toEqual(
      ['CANCEL', 'START_MATCHING'].sort(),
    );
  });

  it('ofertas_enviadas permite OFFER_ACCEPTED + ALL_OFFERS_EXPIRED + CANCEL', () => {
    expect(getValidEventsForTripStatus('ofertas_enviadas').sort()).toEqual(
      ['ALL_OFFERS_EXPIRED', 'CANCEL', 'OFFER_ACCEPTED'].sort(),
    );
  });

  it('terminales no permiten ningún evento', () => {
    expect(getValidEventsForTripStatus('entregado')).toEqual([]);
    expect(getValidEventsForTripStatus('cancelado')).toEqual([]);
  });
});
