import { describe, expect, it } from 'vitest';
import {
  type AssignmentEvent,
  type AssignmentStatus,
  InvalidTransitionError,
  assertAssignmentTransition,
  canAssignmentTransition,
  getNextAssignmentStatus,
  getValidEventsForAssignmentStatus,
  isTerminalAssignmentStatus,
} from '../src/index.js';

describe('assignmentMachine — happy path', () => {
  it('asignado → recogido → entregado', () => {
    let status: AssignmentStatus = 'asignado';

    status = getNextAssignmentStatus(status, { type: 'PICKUP_CONFIRMED' }) ?? status;
    expect(status).toBe('recogido');

    status = getNextAssignmentStatus(status, { type: 'DELIVERY_CONFIRMED' }) ?? status;
    expect(status).toBe('entregado');

    expect(isTerminalAssignmentStatus(status)).toBe(true);
  });
});

describe('assignmentMachine — cancelación', () => {
  it('asignado → cancelado', () => {
    expect(getNextAssignmentStatus('asignado', { type: 'CANCEL' })).toBe('cancelado');
  });

  it('recogido → cancelado', () => {
    expect(getNextAssignmentStatus('recogido', { type: 'CANCEL' })).toBe('cancelado');
  });
});

describe('assignmentMachine — terminales bloquean todo', () => {
  const allEvents: AssignmentEvent[] = [
    { type: 'PICKUP_CONFIRMED' },
    { type: 'DELIVERY_CONFIRMED' },
    { type: 'CANCEL' },
  ];

  for (const event of allEvents) {
    it(`entregado rechaza ${event.type}`, () => {
      expect(canAssignmentTransition('entregado', event)).toBe(false);
    });

    it(`cancelado rechaza ${event.type}`, () => {
      expect(canAssignmentTransition('cancelado', event)).toBe(false);
    });
  }
});

describe('assignmentMachine — saltos ilegales', () => {
  it('asignado NO puede saltar directo a entregado', () => {
    expect(canAssignmentTransition('asignado', { type: 'DELIVERY_CONFIRMED' })).toBe(false);
  });

  it('recogido NO acepta PICKUP_CONFIRMED (idempotencia rota)', () => {
    expect(canAssignmentTransition('recogido', { type: 'PICKUP_CONFIRMED' })).toBe(false);
  });
});

describe('assertAssignmentTransition', () => {
  it('throws con info útil', () => {
    expect(() => assertAssignmentTransition('entregado', { type: 'CANCEL' })).toThrowError(
      InvalidTransitionError,
    );

    try {
      assertAssignmentTransition('asignado', { type: 'DELIVERY_CONFIRMED' });
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidTransitionError);
      const e = err as InvalidTransitionError;
      expect(e.entity).toBe('assignment');
      expect(e.fromStatus).toBe('asignado');
      expect(e.event).toBe('DELIVERY_CONFIRMED');
    }
  });
});

describe('getValidEventsForAssignmentStatus — UI gating', () => {
  it('asignado permite PICKUP_CONFIRMED + CANCEL', () => {
    expect(getValidEventsForAssignmentStatus('asignado').sort()).toEqual(
      ['CANCEL', 'PICKUP_CONFIRMED'].sort(),
    );
  });

  it('recogido permite DELIVERY_CONFIRMED + CANCEL', () => {
    expect(getValidEventsForAssignmentStatus('recogido').sort()).toEqual(
      ['CANCEL', 'DELIVERY_CONFIRMED'].sort(),
    );
  });

  it('terminales no permiten ningún evento', () => {
    expect(getValidEventsForAssignmentStatus('entregado')).toEqual([]);
    expect(getValidEventsForAssignmentStatus('cancelado')).toEqual([]);
  });
});
