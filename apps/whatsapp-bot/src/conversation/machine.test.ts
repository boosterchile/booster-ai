import { describe, expect, it } from 'vitest';
import { createActor } from 'xstate';
import { conversationMachine } from './machine.js';

function drive(events: Array<{ type: 'USER_MESSAGE'; text: string } | { type: 'CANCEL' }>) {
  const actor = createActor(conversationMachine);
  actor.start();
  for (const ev of events) {
    actor.send(ev);
  }
  return actor;
}

describe('conversationMachine', () => {
  it('starts at idle', () => {
    const actor = createActor(conversationMachine);
    actor.start();
    expect(actor.getSnapshot().value).toBe('idle');
  });

  it('transitions idle → greeting on any USER_MESSAGE', () => {
    const actor = drive([{ type: 'USER_MESSAGE', text: 'hola' }]);
    expect(actor.getSnapshot().value).toBe('greeting');
  });

  it('happy path: 1 → address → address → cargo type → date → submitted', () => {
    const actor = drive([
      { type: 'USER_MESSAGE', text: 'hola' },
      { type: 'USER_MESSAGE', text: '1' },
      { type: 'USER_MESSAGE', text: 'Av. Los Leones 1234, Providencia' },
      { type: 'USER_MESSAGE', text: 'Puerto de Valparaíso' },
      { type: 'USER_MESSAGE', text: '3' }, // refrigerated
      { type: 'USER_MESSAGE', text: 'mañana a las 9am' },
    ]);
    const snap = actor.getSnapshot();
    expect(snap.value).toBe('submitted');
    expect(snap.status).toBe('done');
    expect(snap.context).toMatchObject({
      originAddressRaw: 'Av. Los Leones 1234, Providencia',
      destinationAddressRaw: 'Puerto de Valparaíso',
      cargoType: 'refrigerated',
      pickupDateRaw: 'mañana a las 9am',
    });
  });

  it('invalid menu option stays in greetingInvalid', () => {
    const actor = drive([
      { type: 'USER_MESSAGE', text: 'hola' },
      { type: 'USER_MESSAGE', text: 'algo raro' },
    ]);
    expect(actor.getSnapshot().value).toBe('greetingInvalid');
  });

  it('invalid cargo type stays in askCargoTypeInvalid', () => {
    const actor = drive([
      { type: 'USER_MESSAGE', text: 'hola' },
      { type: 'USER_MESSAGE', text: '1' },
      { type: 'USER_MESSAGE', text: 'origen' },
      { type: 'USER_MESSAGE', text: 'destino' },
      { type: 'USER_MESSAGE', text: 'foobar' }, // invalid cargo
    ]);
    expect(actor.getSnapshot().value).toBe('askCargoTypeInvalid');
  });

  it('"cancelar" always goes to cancelled (terminal)', () => {
    const actor = drive([
      { type: 'USER_MESSAGE', text: 'hola' },
      { type: 'USER_MESSAGE', text: '1' },
      { type: 'USER_MESSAGE', text: 'origen' },
      { type: 'USER_MESSAGE', text: 'cancelar' },
    ]);
    const snap = actor.getSnapshot();
    expect(snap.value).toBe('cancelled');
    expect(snap.status).toBe('done');
  });

  it('CANCEL event (explicit) also reaches cancelled', () => {
    const actor = drive([
      { type: 'USER_MESSAGE', text: 'hola' },
      { type: 'USER_MESSAGE', text: '1' },
      { type: 'CANCEL' },
    ]);
    expect(actor.getSnapshot().value).toBe('cancelled');
  });

  it('option 2 (lookup) routes to placeholder state', () => {
    const actor = drive([
      { type: 'USER_MESSAGE', text: 'hola' },
      { type: 'USER_MESSAGE', text: '2' },
    ]);
    expect(actor.getSnapshot().value).toBe('menuLookupNotImplemented');
  });
});
