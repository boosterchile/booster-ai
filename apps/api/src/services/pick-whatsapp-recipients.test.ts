import { describe, expect, it } from 'vitest';
import {
  pickOperationalWhatsappRecipients,
  pickSafetyWhatsappRecipients,
} from './pick-whatsapp-recipients.js';

describe('pickOperationalWhatsappRecipients', () => {
  it('elige a los despachadores y deja fuera al dueño', () => {
    const picked = pickOperationalWhatsappRecipients([
      { userId: 'dueno', role: 'dueno', whatsappE164: '+56911111111' },
      { userId: 'despacho', role: 'despachador', whatsappE164: '+56922222222' },
    ]);
    expect(picked).toEqual([{ userId: 'despacho', whatsappE164: '+56922222222' }]);
  });

  it('si no hay despachador, avisa a todos los dueños con WhatsApp', () => {
    const picked = pickOperationalWhatsappRecipients([
      { userId: 'a', role: 'dueno', whatsappE164: '+56911111111' },
      { userId: 'b', role: 'dueno', whatsappE164: '+56933333333' },
      { userId: 'c', role: 'conductor', whatsappE164: '+56944444444' },
      { userId: 'd', role: 'dueno', whatsappE164: null },
    ]);
    expect(picked.map((row) => row.userId)).toEqual(['a', 'b']);
  });

  it('colapsa dos fichas con el mismo número', () => {
    const picked = pickOperationalWhatsappRecipients([
      { userId: 'a', role: 'despachador', whatsappE164: '+56911111111' },
      { userId: 'b', role: 'despachador', whatsappE164: '+56911111111' },
    ]);
    expect(picked).toHaveLength(1);
  });
});

describe('pickSafetyWhatsappRecipients', () => {
  it('incluye dueño y despachador, y excluye al conductor', () => {
    const picked = pickSafetyWhatsappRecipients([
      { userId: 'dueno', role: 'dueno', whatsappE164: '+56911111111' },
      { userId: 'despacho', role: 'despachador', whatsappE164: '+56922222222' },
      { userId: 'conductor', role: 'conductor', whatsappE164: '+56933333333' },
    ]);
    expect(picked.map((row) => row.userId)).toEqual(['dueno', 'despacho']);
  });
});
